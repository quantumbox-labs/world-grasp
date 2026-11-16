// 日本語 / English for WALKBACK and the question panel. Default: the browser's language; the
// choice is remembered per browser. Usage: const t = useT(); t('帰れる', 'Can walk back').
import { useEffect, useState } from 'react';

export type Lang = 'ja' | 'en';
const KEY = 'walkback.lang';
const listeners = new Set<(l: Lang) => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch { /* storage blocked */ }
  return typeof navigator !== 'undefined' && /^ja\b/i.test(navigator.language) ? 'ja' : 'en';
}

let current: Lang = initial();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;
export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  listeners.forEach((fn) => fn(l));
}

export function useLang(): Lang {
  const [l, set] = useState(current);
  useEffect(() => { listeners.add(set); set(current); return () => { listeners.delete(set); }; }, []);
  return l;
}

export type T = (ja: string, en: string) => string;
export function useT(): T {
  const l = useLang();
  return (ja, en) => (l === 'ja' ? ja : en);
}
