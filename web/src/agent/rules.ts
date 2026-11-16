// Rules agent: no AI. Picks tools from keywords in a Japanese or English question and answers by
// joining the tools' own text. It never computes or invents a number: the only numbers it adds to a
// tool call are ones typed in the question ("酸素6時間", "3 km").
import { callTool } from './port';
import type { AgentEvent, AgentPort, ToolDef, ToolResult } from './types';

export type Lang = 'ja' | 'en';
export interface Step { name: string; args: Record<string, unknown> }

export const detectLang = (q: string): Lang => (/[぀-ヿ一-鿿]/.test(q) ? 'ja' : 'en');

const toHalf = (q: string) => q.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/３Ｄ|3Ｄ|３D/g, '3D');
const NUM = '(\\d+(?:\\.\\d+)?)';
const pick = (q: string, ...res: RegExp[]) => {
  for (const re of res) { const m = q.match(re); if (m) return Number(m[1]); }
  return undefined;
};

/** Slider values typed in the question. */
export function extractParams(q: string): Record<string, number> {
  const p: Record<string, number> = {};
  const o2 = pick(q, new RegExp(`酸素[^\\d]{0,4}${NUM}\\s*(?:時間|h)`, 'i'), new RegExp(`(?:o2|o₂|oxygen)[^\\d]{0,6}${NUM}\\s*(?:h|hours?)`, 'i'), new RegExp(`${NUM}\\s*(?:h|hours?)\\s*(?:of\\s*)?(?:o2|o₂|oxygen)`, 'i'));
  const water = pick(q, new RegExp(`(?:冷却水|水)[^\\d]{0,4}${NUM}\\s*(?:時間|h)`, 'i'), new RegExp(`water[^\\d]{0,6}${NUM}\\s*(?:h|hours?)`, 'i'), new RegExp(`${NUM}\\s*(?:h|hours?)\\s*(?:of\\s*)?(?:cooling\\s*)?water`, 'i'));
  const speed = pick(q, new RegExp(`(?:速さ|速度|時速)[^\\d]{0,4}${NUM}`, 'i'), new RegExp(`${NUM}\\s*km\\s*/\\s*h`, 'i'), new RegExp(`speed[^\\d]{0,6}${NUM}`, 'i'));
  const reserve = pick(q, new RegExp(`(?:余裕|予備)[^\\d]{0,4}${NUM}\\s*[%％]`, 'i'), new RegExp(`reserve[^\\d]{0,6}${NUM}\\s*%`, 'i'), new RegExp(`${NUM}\\s*%\\s*reserve`, 'i'));
  if (o2 != null) p.o2_h = o2;
  if (water != null) p.water_h = water;
  if (speed != null) p.speed_kmh = speed;
  if (reserve != null) p.reserve = reserve;
  return p;
}

/** Distance typed in the question ("3km先", "3 km"), excluding km/h speeds. */
export function extractKm(q: string): number | undefined {
  const m = q.match(new RegExp(`${NUM}\\s*(?:km|ｋｍ|キロ)(?!\\s*/\\s*h)`, 'i'));
  return m ? Number(m[1]) : undefined;
}

const has = (q: string, re: RegExp) => re.test(q);

/** Which tools to call, in order. */
export function plan(question: string, available: Set<string>): Step[] {
  const q = toHalf(question);
  const lang = detectLang(q);
  const steps: Step[] = [];
  const add = (name: string, args: Record<string, unknown> = {}) => { if (available.has(name)) steps.push({ name, args }); };

  // An obstacle reported on the way (astronaut view): register it and search the route again.
  if (has(q, /障害物|通れな|塞が|ふさが|岩.{0,6}(?:ある|邪魔)|ルート.{0,4}再検索|再検索|obstacle|blocked|in the way|reroute|re-?route/i)) {
    const num = (re: RegExp) => { const m = q.match(re); return m ? Number(m[1]) : undefined; };
    const width = num(/(?:横|幅|width|wide)\D{0,8}(\d+(?:\.\d+)?)\s*(?:m|メートル)/i) ?? num(/(\d+(?:\.\d+)?)\s*(?:m|メートル)\s*(?:wide|の幅|にわたって|にわたり)/i);
    const ahead = num(/(\d+(?:\.\d+)?)\s*(?:m|メートル)\s*(?:先|前方|ahead)/i);
    add('report_obstacle', { ...(width != null ? { width_m: width } : {}), ...(ahead != null ? { ahead_m: ahead } : {}), lang });
    if (steps.length) return steps;
  }
  const params = extractParams(q);
  const km = extractKm(q);
  const wantPlay = has(q, /歩いて見せ|歩く(?:様子|ところ)|ヘルメット|helmet|play|show (?:me )?(?:the )?walk|walk me/i);
  const want3d = has(q, /3D|立体|俯瞰|three.?d/i);
  const wantRehearsal = has(q, /練習|同じ坂|リハーサル|practi[cs]e|rehears|same slope/i);
  const wantExplore = !wantRehearsal && has(q, /どこで|いつ|訓練|季節|時期|裸地|火山|火星っぽ|試験|テスト|\d+\s*月|where|when|season|train|volcan|test in|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  // Which rehearsal test and which Moon/Mars target the question is about (default: walking at Jezero).
  const test = has(q, /氷|ice/i) ? 'ice' : has(q, /着陸|landing/i) ? 'landing' : has(q, /洞窟|溶岩洞|cave/i) ? 'caves' : has(q, /建設|表土|build|construct/i) ? 'build' : 'walk';
  const target = test === 'ice' ? 'arcadia' : test === 'caves' ? 'arsia' : 'jezero';
  const wantEvidence = has(q, /根拠|出典|本当|ソース|データ元|証拠|evidence|source|really|proof|why/i);
  const wantWalkRec = has(q, /歩いた記録|GPX|散歩|歩いたログ|歩いた道|recorded walk|my walk|our walk|walk log/i);
  const wantRover = has(q, /壊れ|故障|ローバー.*(?:引き返|帰)|有人ローバー|break(?:s)? down|broke down|crewed rover/i);
  const wantCheck = !wantRover && has(q, /帰れ|戻れ|帰って|戻って|歩いて帰|帰還|間に合|return|walk back|get back|make it back|come back/i) || (km != null && !wantExplore);

  if (Object.keys(params).length) add('view_set_params', params);
  // Destination ideas from NASA data inside the walk-home area.
  if (has(q, /見どころ|行き先|行ける場所|どこに行|目的地.{0,6}候補|近くに何|nearby|worth (?:visiting|seeing)|destination ideas|where (?:can|could|should) (?:i|we) go/i)) add('nearby_spots', { lang });
  // Counting questions on the NASA tables → query_nasa with a fixed, readable SQL.
  const evaH = q.match(/(?:船外活動|EVA|spacewalk)[^\d]{0,20}(\d+(?:\.\d+)?)\s*(?:時間|h|hours?)\s*(?:を?超え|以上|より長|over|longer|more)/i)
    ?? q.match(/(\d+(?:\.\d+)?)\s*(?:時間|h|hours?)\s*(?:を?超え|以上|より長|over|longer|more)[^。?？]{0,20}(?:船外活動|EVA|spacewalk)/i);
  if (evaH) add('query_nasa', { sql: `SELECT count(*) AS evas, max(hours) AS longest_h FROM eva WHERE hours > ${Number(evaH[1])}` });
  const solQ = q.match(/sol\s*(\d+)\s*(?:まで|の時点)/i) ?? q.match(/(?:by|until|up to)\s*sol\s*(\d+)/i);
  if (solQ && has(q, /走|距離|km|drive|driven|far/i)) add('query_nasa', { sql: `SELECT max(km) AS km_driven, max(sol) AS last_sol FROM rover_traverse WHERE mission = 'm20' AND sol <= ${Number(solQ[1])}` });
  // Route evaluation material (totals, by departure time, by segment).
  if (has(q, /評価|採点|比べ|内訳|evaluate|assess|break ?down/i) && !has(q, /北海道|Hokkaido/i)) add('evaluate_route', { lang });
  // Gazetteer: landing sites, crewed-landing candidates, or where/how big a named feature is.
  if (has(q, /着陸(?:した|地点の一覧|地点を?全部|地点はどこ)|過去の着陸|landing sites|where did .* land|landers/i))
    add('query_nasa', { sql: "SELECT name, agency, year, lat, lon FROM mars_names WHERE kind = 'landing' ORDER BY year" });
  if (has(q, /有人着陸の?候補|crewed landing (?:site|candidate)|human landing (?:site|candidate)/i))
    add('query_nasa', { sql: "SELECT name, lat, lon, diameter_km FROM mars_names WHERE kind = 'crewed' ORDER BY name" });
  const named = q.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:クレーター|crater)?\s*(?:は|って)?\s*(?:どこ|どのくらい|大きさ|由来)/)
    ?? q.match(/(?:where is|how (?:big|large) is|what is .* named after\??|where's)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (named && !/^(Mars|Jezero Crater Perseverance)$/.test(named[1]))
    add('query_nasa', { sql: `SELECT name, type, lat, lon, diameter_km, origin FROM mars_names WHERE kind = 'feature' AND name ILIKE '%${named[1].replace(/[^A-Za-z ]/g, '')}%' ORDER BY diameter_km DESC NULLS LAST LIMIT 5` });
  if (wantWalkRec) {
    add('import_walk', { lang });
    if (wantPlay || has(q, /再生|火星で歩|replay/i)) add('mars_replay', { action: 'play' });
  }
  if (wantRover) add('rover_walkback', { lang });
  if (!wantWalkRec && (wantCheck || wantRehearsal || (wantPlay && !wantExplore && !wantRover))) {
    const args: Record<string, unknown> = { lang };
    if (km != null) args.route = /走|ローバー|探査車|drive|rover/i.test(q) ? { along_rover_km: km } : { away_km: km };
    if (wantRehearsal) args.with_rehearsal = true;
    add('walkback_check', args);
    if (wantRehearsal) add('view_overlay', { rehearsal_index: 0 });
  }
  if (wantExplore) {
    const bare = has(q, /裸地|火山|植物がない|植生がない|火星っぽ|bare|volcan|no vegetation|mars-like/i);
    add('explore_hokkaido', { target, test, n: 5, ...(bare ? { bare_only: true } : {}) });
  }
  if (wantEvidence) {
    const topics: string[] = [];
    if (has(q, /探査車|ローバー|パーシビアランス|rover|perseverance|drive/i)) topics.push('rover');
    if (has(q, /船外|EVA|宇宙遊泳|spacewalk/i)) topics.push('eva');
    if (has(q, /北海道|hokkaido/i)) topics.push('hokkaido_terrain');
    else if (has(q, /地形|標高|terrain|elevation|DEM/i)) topics.push('terrain');
    if (has(q, /酸素|冷却水|水|消耗|O2|oxygen|water|consumab/i) && !Object.keys(params).length) topics.push('consumables');
    for (const topic of topics.length ? topics : ['rover', 'eva', 'consumables']) add('open_evidence', { topic, lang });
  }
  if (!wantExplore && has(q, /季節|冬|夏|重み|season|winter|summer|weight/i)) add('view_scan', { target, test, mode: 'scan' });
  if (has(q, /全球|地球儀|火星全体|火星の全体|globe|whole planet|whole mars/i)) add('view_globe', { on: true });
  if (!wantWalkRec && (want3d || (!steps.length && has(q, /見せて|show/i)))) add('view_3d', { on: true });
  if (wantPlay && !wantWalkRec) add('view_walk', { action: 'play' });
  if (!steps.length && Object.keys(params).length === 0) return [];
  // Sliders alone: report what they mean for the current route.
  if (steps.length === 1 && steps[0].name === 'view_set_params') add('walkback_check', { lang });
  return steps;
}

/** explore_hokkaido rows, laid out in Japanese. Every value is copied from the tool's data. */
function exploreJa(r: ToolResult): string | null {
  const rows = r.data as { lat: number; lon: number; elev_m: number; slope_deg: number; score: number; near_site_ja: string | null; near_km: number | null; season_ja: string }[] | undefined;
  if (!Array.isArray(rows)) return null;
  if (!rows.length) return '条件に合う北海道の 1 km マスは見つかりませんでした。';
  const line = (x: (typeof rows)[number], i: number) =>
    `${i + 1}) ${x.near_site_ja ? `${x.near_site_ja}付近（${x.near_km} km）` : `北緯${x.lat.toFixed(2)} 東経${x.lon.toFixed(2)}`} 標高 ${Math.round(x.elev_m)} m・傾斜 ${x.slope_deg.toFixed(1)}°・スコア ${x.score.toFixed(2)}`;
  return `この訓練に向く北海道の場所: ${rows.map(line).join('; ')}。時期: ${rows[0].season_ja}。`;
}

const HELP: Record<Lang, string> = {
  ja: 'こんな質問に答えられます: 「基地から3km先まで歩いて帰れる？」「酸素6時間なら？」「同じ坂の練習コースを北海道で探して」「この訓練、北海道のどこでいつやる？」「根拠を見せて」「3Dで歩いて見せて」。',
  en: 'Try: "Can I walk back from 3 km out?", "What if O2 is 6 hours?", "Find a practice course in Hokkaido with the same slopes", "Where and when in Hokkaido should we train?", "Show the evidence", "Show the walk in 3D".',
};

export const rulesAgent: AgentPort = {
  id: 'rules',
  get label() { return 'QA'; },
  available: () => true,
  async ask(prompt, tools: ToolDef[], onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
    const lang = detectLang(prompt);
    const steps = plan(prompt, new Set(tools.map((t) => t.name)));
    if (!steps.length) { onEvent({ type: 'text', text: HELP[lang] }); onEvent({ type: 'done' }); return; }
    const parts: string[] = [];
    for (const s of steps) {
      if (signal?.aborted) { onEvent({ type: 'error', message: lang === 'ja' ? '中止しました' : 'Stopped' }); return; }
      const args = { ...s.args };
      const { ok, result } = await callTool(s.name, args, onEvent);
      // Show the best explore_hokkaido cell on the map (coordinates copied from that tool's result).
      if (s.name === 'explore_hokkaido' && ok) {
        const rows = result.data as { lat: number; lon: number }[] | undefined;
        if (rows?.length && tools.some((t) => t.name === 'view_scan')) {
          await callTool('view_scan', { target: args.target ?? 'jezero', test: args.test ?? 'walk', mode: 'scan', focus: { lat: rows[0].lat, lon: rows[0].lon } }, onEvent);
        }
      }
      const tool = tools.find((t) => t.name === s.name);
      if (!ok) parts.push(result.text);
      else if (tool?.kind === 'compute') parts.push(lang === 'ja' && s.name === 'explore_hokkaido' ? exploreJa(result) ?? result.text : result.text);
    }
    if (!parts.length) parts.push(lang === 'ja' ? '画面を切り替えました。' : 'Updated the view.');
    onEvent({ type: 'text', text: parts.join('\n') });
    onEvent({ type: 'done' });
  },
};
