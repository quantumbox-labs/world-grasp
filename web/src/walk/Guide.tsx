// First-visit guide for WALKBACK: what the screen does, in three steps. Closed once, it stays closed
// in this browser.
import { useState } from 'react';
import { useT } from '../i18n';

const KEY = 'walkback.guide.closed';
const closedBefore = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

export function Guide() {
  const t = useT();
  const [open, setOpen] = useState(() => !closedBefore());
  if (!open) return null;
  const close = () => { setOpen(false); try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } };
  return (
    <div className="guide" role="dialog" aria-labelledby="guide-h">
      <h3 id="guide-h">{t('火星の基地から歩いて、帰ってこられるか', 'Walk out from a Mars base. Can you make it back?')}</h3>
      <ol>
        <li><b>{t('ルートを引く', 'Draw a route')}</b>{t('地図をクリック。最初の点が基地です。★で例のルート。', 'Click the map. The first point is the base. ★ loads an example.')}</li>
        <li><b>{t('帰れるか見る', 'See if you get back')}</b>{t('左に判定と、酸素・冷却水のどちらが先に尽きるか。▶でヘルメット表示で歩けます。', 'The panel shows the verdict and whether oxygen or cooling water runs out first. ▶ walks it in a helmet view.')}</li>
        <li><b>{t('北海道で練習する', 'Practise in Hokkaido')}</b>{t('同じ坂の練習コースを北海道で探せます。', 'Find a course in Hokkaido with the same slopes.')}</li>
      </ol>
      <p className="muted">{t('右下の質問欄でも聞けます。数字はすべて NASA データと計算エンジンから。', 'You can also ask in the panel at the bottom right. Every number comes from NASA data and the calculation engine.')}</p>
      <button className="primary" onClick={close}>{t('はじめる', 'Start')}</button>
    </div>
  );
}
