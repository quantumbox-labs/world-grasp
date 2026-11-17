// world-grasp 地球タブの情報パネル用: NASA EONET v3 の進行中イベント取得。
// これは情報表示専用で、エンジン (analog-core) の判定には一切影響しない。
// ライブ取得に失敗したら (オフライン / CORS / 形式不正)、同梱サンプル
// (eonet-sample.json、API と同じ形) にフォールバックし、呼び出し側が
// どちらのモードかを表示する。
import sampleJson from './eonet-sample.json';

export interface EonetEvent {
  id: string;
  title: string;
  /** 先頭カテゴリの表示名 (例: Wildfires)。 */
  category: string;
  /** geometry のうち最新の日付 (ISO 文字列)。 */
  date: string;
  /** EONET のイベントページへのリンク。 */
  link: string;
  /** 出典 (sources[0]) の URL。無ければ null。 */
  sourceUrl: string | null;
}

export interface EonetResult {
  events: EonetEvent[];
  /** true = ライブ API の結果、false = 同梱サンプル。 */
  live: boolean;
}

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=50';

interface RawGeometry { date?: string }
interface RawEvent {
  id?: string;
  title?: string;
  link?: string;
  categories?: { title?: string }[];
  sources?: { url?: string }[];
  geometry?: RawGeometry[];
}

function parse(raw: unknown): EonetEvent[] {
  const events = (raw as { events?: RawEvent[] } | null)?.events;
  if (!Array.isArray(events)) return [];
  const out: EonetEvent[] = [];
  for (const e of events) {
    if (!e || typeof e.title !== 'string') continue;
    const dates = (e.geometry ?? []).map((g) => g.date).filter((d): d is string => typeof d === 'string').sort();
    out.push({
      id: typeof e.id === 'string' ? e.id : e.title,
      title: e.title,
      category: e.categories?.[0]?.title ?? '—',
      date: dates[dates.length - 1] ?? '',
      link: typeof e.link === 'string' ? e.link : EONET_URL,
      sourceUrl: e.sources?.[0]?.url ?? null,
    });
  }
  // 新しいイベント (最新 geometry の日付) を上に。
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function loadEonet(): Promise<EonetResult> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let events: EonetEvent[] = [];
    try {
      const r = await fetch(EONET_URL, { signal: ctl.signal });
      if (!r.ok) throw new Error(`EONET HTTP ${r.status}`);
      events = parse(await r.json());
    } finally {
      clearTimeout(timer);
    }
    if (!events.length) throw new Error('EONET: no events parsed');
    return { events, live: true };
  } catch {
    return { events: parse(sampleJson), live: false };
  }
}
