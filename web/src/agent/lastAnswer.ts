// The latest question and answer from the question panel, for the helmet HUD.
import { useEffect, useState } from 'react';
import type { PlanParams } from '../walk/plan';

export interface QA {
  q: string; a: string; at: number; voice?: boolean;
  /** Slider conditions in effect when the answer was produced. */
  cond?: PlanParams;
}
let last: QA | null = null;
const subs = new Set<(x: QA | null) => void>();

export function publishAnswer(x: QA) { last = x; subs.forEach((f) => f(x)); }
export function useLastAnswer(): QA | null {
  const [v, set] = useState(last);
  useEffect(() => { subs.add(set); set(last); return () => { subs.delete(set); }; }, []);
  return v;
}
