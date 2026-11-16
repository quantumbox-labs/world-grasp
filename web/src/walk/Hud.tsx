// Helmet-style overlay shown over the map while a walk is played back.
import { fmtH } from './geo';
import { useT } from '../i18n';
import { useLastAnswer } from '../agent/lastAnswer';

export interface HudState {
  t_h: number; km: number; o2: number; water: number; home_h: number; margin_h: number;
  phase: 'out' | 'turn' | 'back' | 'done';
  slope: number | null;
}

const Gauge = ({ label, v, warn }: { label: string; v: number; warn: boolean }) => (
  <div className={`hud-gauge${warn ? ' warn' : ''}`}>
    <span>{label}</span>
    <div className="hud-track"><div style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></div>
    <b>{Math.round(Math.max(0, v) * 100)}%</b>
  </div>
);

export function Hud({ s, limiting, onStop, children, rad }: {
  s: HudState; limiting: 'o2' | 'water'; onStop: () => void; children?: React.ReactNode;
  /** Radiation dose so far (Rust radiation.rs: Curiosity RAD rate, NASA career limit). */
  rad?: (hours: number) => { dose_msv: number; career_share: number } | null;
}) {
  const t = useT();
  const qa = useLastAnswer();
  const msg =
    s.phase === 'turn' ? t('引き返し地点。今すぐ基地へ戻る', 'Turn-back point. Head back to base now') :
    s.phase === 'back' ? t('帰還中', 'Returning') :
    s.phase === 'done' ? t('基地に帰着', 'Back at base') :
    s.margin_h < 0.5 ? t('まもなく引き返し地点', 'Turn-back point soon') : '';
  // Turn-back alert: inside the last 45 min of margin on the way out (or at the turn), the visor
  // turns red and a flag shows how much margin is left. Same numbers as the plan (ev.ticks).
  const near = (s.phase === 'out' && s.margin_h < 0.75) || s.phase === 'turn';
  return (
    <div className={`hud phase-${s.phase}${near ? ' near-turn' : ''}`} role="status" aria-live="polite">
      {near && (
        <div className="hud-flag">🚩 {s.phase === 'turn' ? t('引き返し地点', 'Turn-back point') : t(`引き返し地点まで あと ${fmtH(Math.max(0, s.margin_h))}`, `Turn-back point in ${fmtH(Math.max(0, s.margin_h))}`)}</div>
      )}
      <div className="hud-visor" />
      <div className="hud-top">
        <div><span>{t('経過', 'Elapsed')}</span><b>{fmtH(s.t_h)}</b></div>
        <div><span>{t('歩いた距離', 'Walked')}</span><b>{s.km.toFixed(2)} km</b></div>
        <div><span>{t('帰りに要る時間', 'Time to get home')}</span><b>{fmtH(s.home_h)}</b></div>
        <div><span>{t('足元の坂', 'Slope')}</span><b>{s.slope == null ? '—' : `${s.slope.toFixed(0)}°`}</b></div>
      </div>
      <div className="hud-left">
        <Gauge label="O₂" v={s.o2} warn={limiting === 'o2' && s.o2 < 0.35} />
        <Gauge label={t('冷却水', 'Water')} v={s.water} warn={limiting === 'water' && s.water < 0.35} />
        {(() => {
          const r = rad?.(s.t_h);
          return r ? <div className="hud-rad">☢ {t('放射線', 'Radiation')} <b>{r.dose_msv.toFixed(3)} mSv</b> <small>{t(`生涯上限の ${(r.career_share * 100).toFixed(3)}%`, `${(r.career_share * 100).toFixed(3)}% of career limit`)}</small></div> : null;
        })()}
      </div>
      {msg && <div className={`hud-msg${s.phase === 'turn' || s.margin_h < 0.5 ? ' alert' : ''}`}>{msg}</div>}
      {qa && (
        <div className="hud-qa" aria-live="polite">
          <div className="hud-q">Q {qa.q}</div>
          <div className="hud-a">{qa.a.length > 220 ? `${qa.a.slice(0, 220)}…` : qa.a}</div>
          {qa.cond && (
            <div className="hud-cond">{t(`回答時の条件: 酸素 ${qa.cond.o2} 時間・冷却水 ${qa.cond.water} 時間・速さ ${qa.cond.speed} km/h・余裕 ${qa.cond.reserve}%`, `Settings when answered: O₂ ${qa.cond.o2} h, water ${qa.cond.water} h, speed ${qa.cond.speed} km/h, reserve ${qa.cond.reserve}%`)}</div>
          )}
        </div>
      )}
      {children}
      <button className="hud-stop" onClick={onStop}>{t('■ 止める', '■ Stop')}</button>
    </div>
  );
}
