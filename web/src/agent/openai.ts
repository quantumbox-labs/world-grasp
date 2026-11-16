// Cloud AI with the person's own OpenAI key (settings screen). The browser calls OpenAI directly,
// so the key stays in this browser and never reaches our relay. Same system prompt and the same
// Anthropic-shaped messages as the relay (web/public/_worker.js), translated to chat completions here.
import { getSettings, setSetting } from '../settings';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODELS_API = 'https://api.openai.com/v1/models';

const NOT_CHAT = /embedding|audio|realtime|tts|image|transcribe|search|moderation|whisper|dall-e/i;

/** Chat model ids from a /v1/models list, best first: *terra* → gpt-5 → gpt-4.1 → gpt-4o (plain before -mini, undated before dated). */
export function chatModels(ids: string[]): string[] {
  const fam = (id: string) => (/terra/.test(id) ? 0 : id.startsWith('gpt-5') ? 1 : id.startsWith('gpt-4.1') ? 2 : id.startsWith('gpt-4o') ? 3 : 9);
  const rank = (id: string) => [fam(id), /-(mini|nano)\b/.test(id) ? 1 : 0, /\d{4}-\d{2}-\d{2}/.test(id) ? 1 : 0, id.length] as const;
  return ids.filter((id) => !NOT_CHAT.test(id) && fam(id) < 9).sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
    return a.localeCompare(b);
  });
}

/** The chat models this key can use (empty when the list cannot be read). */
export async function listOpenAIModels(key: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch(OPENAI_MODELS_API, { headers: { authorization: `Bearer ${key.trim()}` }, signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id?: string }[] };
    return chatModels((body.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean));
  } catch { return []; }
}

/** Keep in step with SYSTEM in web/public/_worker.js (a unit test compares them). */
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

type Block = { type: string; [k: string]: unknown };
interface Msg { role: 'user' | 'assistant'; content: string | Block[] }
export interface Spec { name: string; description: string; input_schema: unknown }
export interface Reply { content: Block[]; stop_reason: string; model?: string }

/** Anthropic messages → OpenAI chat messages (thinking blocks dropped). */
export function toOpenAI(system: string, messages: Msg[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }];
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

interface Completion { model?: string; choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] } }[] }
/** OpenAI chat completion → Anthropic message shape. */
export function fromOpenAI(r: Completion): Reply {
  const msg = r.choices?.[0]?.message ?? {};
  const content: Block[] = [];
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

/** The settings say to use the person's own OpenAI key, and one is entered. */
export const openaiOn = () => { const s = getSettings(); return s.cloudVia === 'openai' && !!s.openaiKey.trim(); };

/** One model turn on OpenAI. If the chosen model does not exist for this key, pick one it can use, save it, and retry once.
 * Tools are sent with reasoning_effort 'none' (gpt-6.1-terra refuses function tools with reasoning on /v1/chat/completions);
 * a model that rejects that parameter gets one retry without it. */
export async function openaiTurn(messages: Msg[], specs: Spec[], signal?: AbortSignal): Promise<Reply> {
  const s = getSettings();
  const key = s.openaiKey.trim();
  type Body = Completion & { error?: { message?: string; code?: string } };
  const call = async (model: string, effort: boolean) => {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: toOpenAI(SYSTEM, messages),
        tools: specs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        ...(effort ? { reasoning_effort: 'none' } : {}),
      }),
      signal,
    });
    return { res, body: (await res.json().catch(() => ({}))) as Body };
  };
  const send = async (model: string) => {
    const first = await call(model, true);
    if (first.res.status === 400 && /reasoning_effort/i.test(first.body.error?.message ?? '')) {
      console.info('[agent] OpenAI', model, 'rejected reasoning_effort none; retrying without it');
      return call(model, false);
    }
    return first;
  };
  const wanted = s.openaiModel.trim() || 'gpt-6.1-terra';
  let { res, body } = await send(wanted);
  if (!res.ok && (res.status === 404 || body.error?.code === 'model_not_found')) {
    const pick = (await listOpenAIModels(key, signal)).find((m) => m !== wanted);
    if (!pick) throw new Error(`OpenAI のモデル ${wanted} が使えず、使えるモデルの一覧も取れませんでした。設定画面でモデル名を入れてください / model ${wanted} is not available and the model list could not be read: enter a model name in Settings`);
    setSetting('openaiModel', pick);
    console.info('[agent] OpenAI model', wanted, '→', pick);
    ({ res, body } = await send(pick));
  }
  if (!res.ok) throw new Error(res.status === 401 ? 'OpenAI のキーが正しくありません / the OpenAI key was rejected' : `OpenAI ${res.status}: ${body.error?.message ?? ''}`);
  return fromOpenAI(body);
}
