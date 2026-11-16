// App settings (per browser / per desktop app, best effort in localStorage): which AI answers the
// question panel and which model each AI uses. Usage: const s = useSettings(); setSetting('ai', 'claude').
import { useEffect, useState } from 'react';

/** 'auto' = desktop: in-app AI, web: cloud AI when set up, otherwise QA (the rules version). */
export type AiChoice = 'auto' | 'rules' | 'in-app' | 'claude';
/** In-app AI model size ('auto' = picked from this device's memory and GPU). */
export type InAppModel = 'auto' | '1.7b' | '4b' | '8b';
export interface Settings {
  ai: AiChoice;
  inAppModel: InAppModel;
  /** Cloud AI model id (one of CLOUD_MODELS; the relay checks it again). */
  cloudModel: string;
  /** Desktop app: local model name for the in-app AI ('' = automatic). */
  desktopModel: string;
  /** Cloud AI goes through this site's relay, or straight to OpenAI with the person's own key. */
  cloudVia: 'relay' | 'openai';
  /** The person's OpenAI API key (kept in this browser only). */
  openaiKey: string;
  openaiModel: string;
}
export const OPENAI_MODELS = ['gpt-6.1-terra', 'gpt-5-mini', 'gpt-5', 'gpt-4.1', 'gpt-4.1-mini'];

export const CLOUD_MODELS: { id: string; ja: string; en: string }[] = [
  { id: 'claude-opus-5-5', ja: '高精度（標準）', en: 'Most accurate (default)' },
  { id: 'claude-sonnet-5-5', ja: 'バランス', en: 'Balanced' },
  { id: 'claude-haiku-5-5', ja: '速い', en: 'Fastest' },
];
export const IN_APP_MODELS: { id: InAppModel; ja: string; en: string }[] = [
  { id: 'auto', ja: '自動（この端末に合わせる）', en: 'Automatic (fits this device)' },
  { id: '1.7b', ja: '軽い（約1GB）', en: 'Light (about 1 GB)' },
  { id: '4b', ja: '標準（約2.5GB）', en: 'Standard (about 2.5 GB)' },
  { id: '8b', ja: '高精度（約5GB・高性能な端末向け）', en: 'Most accurate (about 5 GB, high-end devices)' },
];

const KEY = 'walkback.settings';
const OLD_MODEL_KEY = 'walkback.pirsModel'; // earlier override, still honoured
const DEFAULTS: Settings = { ai: 'auto', inAppModel: 'auto', cloudModel: CLOUD_MODELS[0].id, desktopModel: '', cloudVia: 'relay', openaiKey: '', openaiModel: OPENAI_MODELS[0] };

function load(): Settings {
  const s = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    if (['auto', 'rules', 'in-app', 'claude'].includes(raw.ai as string)) s.ai = raw.ai!;
    if (IN_APP_MODELS.some((m) => m.id === raw.inAppModel)) s.inAppModel = raw.inAppModel!;
    else { const old = localStorage.getItem(OLD_MODEL_KEY); if (IN_APP_MODELS.some((m) => m.id === old)) s.inAppModel = old as InAppModel; }
    if (CLOUD_MODELS.some((m) => m.id === raw.cloudModel)) s.cloudModel = raw.cloudModel!;
    if (typeof raw.desktopModel === 'string') s.desktopModel = raw.desktopModel.slice(0, 100);
    if (raw.cloudVia === 'openai') s.cloudVia = 'openai';
    if (typeof raw.openaiKey === 'string') s.openaiKey = raw.openaiKey.slice(0, 300);
    if (typeof raw.openaiModel === 'string' && raw.openaiModel.trim() && !['gpt-5-mini', 'gpt-terra-6.1'].includes(raw.openaiModel.trim())) s.openaiModel = raw.openaiModel.slice(0, 100); // old default → new default
  } catch { /* storage blocked or bad JSON: defaults */ }
  return s;
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export const getSettings = (): Settings => current;
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage blocked */ }
  listeners.forEach((fn) => fn(current));
}
export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function useSettings(): Settings {
  const [s, set] = useState(current);
  useEffect(() => { set(current); return onSettings(set); }, []);
  return s;
}
