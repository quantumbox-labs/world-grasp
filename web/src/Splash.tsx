// Start-up splash: "WALKBACK", one line, a slowly turning Mars (the bundled Viking MDIM 2.1 colour
// mosaic scrolled inside a shaded disc) and the loading progress, while the Rust core and the Jezero
// data load. Click or any key skips it. Shorter after the first visit (localStorage, best effort);
// skipped under automation (navigator.webdriver) unless the URL has ?splash.
import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n';

const SEEN = 'walkback.splash.seen';
const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* private mode */ } };

/** Whether to show the splash at all on this load. */
export function wantSplash() {
  if (typeof window === 'undefined') return false;
  if (/[?&]splash\b/.test(location.search)) return true;
  return !navigator.webdriver;
}

export function Splash({ ready, steps, onDone }: {
  /** Loading finished (core and data). */
  ready: boolean;
  /** Loading steps done so far / total, for the progress line. */
  steps: [number, number];
  onDone: () => void;
}) {
  const t = useT();
  const first = useRef(!seen());
  const minMs = first.current ? 2000 : 700;
  const [t0] = useState(() => performance.now());
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    markSeen();
    setLeaving(true);
    setTimeout(onDone, 350);
  };
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(finish, Math.max(0, minMs - (performance.now() - t0)));
    return () => clearTimeout(id);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const skip = () => finish();
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [a, n] = steps;
  return (
    <div className={`splash${leaving ? ' leaving' : ''}`} onClick={finish} role="dialog" aria-label="WALKBACK">
      <div className="splash-mars" aria-hidden="true" style={{ backgroundImage: 'url(./data/globe/mars_viking.jpg)' }} />
      <h1>WALKBACK</h1>
      <p className="splash-line">{t('火星で、歩いて帰れるか。', 'On Mars, can you walk back?')}</p>
      <div className="splash-progress" aria-live="polite">
        <div className="splash-bar"><div style={{ width: `${n ? (a / n) * 100 : 0}%` }} /></div>
        <span>{ready ? t('準備できました', 'Ready') : t(`読み込み中 ${a} / ${n}`, `Loading ${a} / ${n}`)}</span>
      </div>
      <p className="splash-src">NASA data: Mars Odyssey THEMIS · MRO HiRISE · MGS MOLA / TES · Viking · Mars 2020 · Curiosity RAD</p>
      <p className="splash-skip">{t('クリックかキーで飛ばせます', 'Click or press a key to skip')}</p>
    </div>
  );
}
