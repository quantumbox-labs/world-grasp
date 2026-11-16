// Cloudflare Pages worker (advanced mode: Vite copies web/public/_worker.js into web/dist, and Pages
// runs it in front of the static files). It does one thing: relay the question panel's Claude
// requests with the credential kept here, so it never reaches the browser.
//   GET  /api/agent   → { available, model, via }   (is a credential set?)
//   POST /api/agent   → one model turn               ({ messages, tools } from web/src/agent/claude.ts)
// Requests and replies use the Anthropic Messages shape on both sides of the browser.
// Two ways out, whichever secret is set on the tachyon app (tachyon env set <app> --secret NAME):
//   TACHYON_API_KEY    → the tachyon AI gateway (OpenAI-style chat completions, translated here)
//   ANTHROPIC_API_KEY  → the Anthropic API directly
// The model list, the system prompt and the limits are fixed here, so the page cannot turn the relay
// into a general-purpose proxy. Everything else is served from the static files.
// Plain JS with no imports: this file is not bundled.

const MODEL = 'claude-opus-5-5';
// Models the settings screen may pick (anything else falls back to MODEL).
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const TACHYON_API = 'https://api.n1.tachy.one/v1/llms/chat/completions';
const TACHYON_TENANT = 'tn_01m71hyn06c1mpz8y22ywn8qq3'; // nasa-hackason tenant (scripts/tachyon.preview.yml)
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_BODY = 400_000; // bytes of the incoming request
const MAX_MESSAGES = 60;
const MAX_TOOLS = 40;

// Same rules as the desktop agent (src-tauri/src/agent.rs SYSTEM_PROMPT), plus the web specifics.
export const SYSTEM = `あなたは WALKBACK（火星の船外活動で「歩いて帰れるか」を判定するアプリ）の相棒。質問には必ず先にツールを呼ぶ。
- 帰れるか・距離・時間・酸素や冷却水の条件の質問は walkback_check（数値条件は o2_h などの引数に入れる。「Nkm先」は route={"away_km":N}）。練習コースは walkback_check に with_rehearsal=true。
- ローバーが壊れたら・どこで引き返すかは rover_walkback。目的地までの道を自動で引くときは plan_route（lat, lon）。経路の評価・比較・説明は evaluate_route（距離・時間・登り下り・坂・足場・出発時刻別の酸素と冷却水・放射線・区間ごと、出典付き）の数字をそのまま使う。
- 根拠・出典は open_evidence（topic は rover, eva, consumables など）。
- 北海道のどこで・いつ訓練するかは explore_hokkaido。歩いた記録・GPX は import_walk。
- 見せてと言われたら表示ツール（view_3d, view_walk, view_globe など）で地図を動かす。
- 件数・範囲・一覧など、ほかのツールで答えられない質問は query_nasa に読み取り専用の SELECT を1つ渡して表から引く（集計や WHERE で絞る）。Perseverance が何 km 走ったか・sol ごとの位置は rover_traverse 表（例: SELECT max(km) FROM rover_traverse WHERE sol <= 1000）。船外活動の回数や時間は eva 表。Jezero の足場（熱慣性・ダスト被覆）は mars_footing 表。船外活動の放射線（Curiosity RAD の線量率と NASA の上限）は mars_radiation 表。Jezero の時刻ごとの気温・気圧（Perseverance MEDA）は mars_weather 表。火星の地名・着陸地点・有人着陸の候補地は mars_names 表（例: SELECT name, lat, lon, diameter_km FROM mars_names WHERE name ILIKE '%Jezero%'）。
- どんな表・列があるか分からないときは list_nasa_tables（table を渡すと列の型と例）。列の件数・最小・最大・平均・中央値・欠損は summarize_nasa（where で絞り込み、group_by でグループ別）。グループ間や2つの条件の比較は compare_nasa（group_by か where_a と where_b）。細かい条件の集計は query_nasa。
- walkback_check は歩く計画の判定だけに使う。
数字の決まり（最重要）: 答えに書く数字は、ツールの結果の文に出てくる数字だけを、そのまま写す。自分で計算・換算・四捨五入・推測をしない。ツールで出せない数字は「ツールでは出せません」と言う。
最後に出典（sources）を一言添える。ユーザーの言語で、短く（3〜6文）答える。答えはそのまま文字で表示されるので、**太字** や見出しなどのマークダウン記法は使わない（箇条書きは「・」で）。`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function validTools(tools) {
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) return null;
  const out = [];
  for (const t of tools) {
    if (!t || typeof t.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) return null;
    out.push({ name: t.name, description: String(t.description ?? '').slice(0, 4000), input_schema: t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object' } });
  }
  return out;
}

/** Which way out: the tachyon gateway (preferred) or Anthropic. Local dev may pass short-lived tokens. */
function backend(env) {
  if (env.TACHYON_API_KEY) return { via: 'tachyon', token: env.TACHYON_API_KEY };
  if (env.ANTHROPIC_API_KEY) return { via: 'anthropic', apiKey: env.ANTHROPIC_API_KEY };
  if (env.ANTHROPIC_AUTH_TOKEN) return { via: 'anthropic', token: env.ANTHROPIC_AUTH_TOKEN };
  return null;
}

// ---- Anthropic directly ----
async function anthropicTurn(b, body) {
  const send = (withFallback) => {
    const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    const betas = withFallback ? [FALLBACK_BETA] : [];
    if (b.apiKey) headers['x-api-key'] = b.apiKey;
    else { headers.authorization = `Bearer ${b.token}`; betas.push('oauth-2025-04-20'); }
    if (betas.length) headers['anthropic-beta'] = betas.join(',');
    return fetch(ANTHROPIC_API, { method: 'POST', headers, body: JSON.stringify(withFallback ? { ...body, fallbacks: 'default' } : body) });
  };
  let res = await send(true);
  if (res.status === 400) {
    // An account without the fallback beta: try once more without it.
    const text = await res.text();
    if (!/fallback/i.test(text)) return new Response(text, { status: 400, headers: { 'content-type': 'application/json' } });
    res = await send(false);
  }
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// ---- tachyon AI gateway (OpenAI-style) ----
/** Anthropic messages → OpenAI chat messages. Thinking blocks are dropped (the gateway has no slot for them). */
export function toOpenAI(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = blocks.filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const b of blocks) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
        else if (b.type === 'text') out.push({ role: 'user', content: b.text });
      }
    }
  }
  return out;
}

/** OpenAI chat completion → Anthropic message shape. */
export function fromOpenAI(r) {
  const msg = r.choices?.[0]?.message ?? {};
  const content = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  for (const c of msg.tool_calls ?? []) {
    let input = {};
    try { input = JSON.parse(c.function?.arguments || '{}'); } catch { input = {}; }
    content.push({ type: 'tool_use', id: c.id, name: c.function?.name, input });
  }
  const fin = r.choices?.[0]?.finish_reason;
  const stop_reason = fin === 'tool_calls' || (msg.tool_calls?.length ?? 0) > 0 ? 'tool_use' : fin === 'length' ? 'max_tokens' : 'end_turn';
  return { model: r.model, stop_reason, content };
}

async function tachyonTurn(b, body) {
  const res = await fetch(TACHYON_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${b.token}`, 'x-operator-id': TACHYON_TENANT },
    body: JSON.stringify({
      model: `anthropic/${body.model}`,
      stream: false,
      max_tokens: body.max_tokens,
      messages: toOpenAI(body.system, body.messages),
      tools: body.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
  });
  const text = await res.text();
  if (!res.ok) return json({ error: { message: `tachyon gateway ${res.status}: ${text.slice(0, 300)}` } }, res.status === 401 || res.status === 403 ? 502 : res.status);
  let r;
  try { r = JSON.parse(text); } catch { return json({ error: { message: 'tachyon gateway: bad JSON' } }, 502); }
  return json(fromOpenAI(r));
}

async function agent(req, env) {
  const b = backend(env);
  if (req.method === 'GET') return json({ available: !!b, model: MODEL, models: MODELS, via: b?.via ?? null });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!b) return json({ error: 'not_configured', message: 'no TACHYON_API_KEY / ANTHROPIC_API_KEY on this deployment' }, 503);
  // Only this site's own pages (browsers always send Origin on a cross-site POST).
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json({ error: 'forbidden' }, 403);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const tools = validTools(input.tools ?? []);
  const messages = input.messages;
  if (!tools || !Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return json({ error: 'bad_request' }, 400);
  const model = MODELS.includes(input.model) ? input.model : MODEL;
  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages,
    tools,
    // Quick answers; the tools do the real work. (Haiku takes no effort setting.)
    ...(model.includes('haiku') ? {} : { output_config: { effort: 'low' } }),
  };
  return b.via === 'tachyon' ? tachyonTurn(b, body) : anthropicTurn(b, body);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/agent') {
      try { return await agent(req, env); } catch (e) { return json({ error: 'relay_failed', message: String(e) }, 502); }
    }
    return env.ASSETS.fetch(req);
  },
};
