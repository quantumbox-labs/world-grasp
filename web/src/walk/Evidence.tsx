// Evidence cards: how the plan compares with Perseverance's real drives and with real EVAs.
import { useT } from '../i18n';
import type { EvaStats, RouteCheck } from '../core';

export function RoverCard({ check }: { check: RouteCheck | null }) {
  const t = useT();
  if (!check) return null;
  const r = check.rover;
  const steepOk = check.route_max_slope <= r.slope_max;
  return (
    <div className="card">
      <h4>{t('探査車の実走ルートと照らす', "Checked against Perseverance's real drives")}</h4>
      <div className="big-line"><b>{Math.round(check.near_share * 100)}%</b><span>{t(`のルートが、Perseverance が実際に走った道から ${check.near_m}m 以内`, `of the route is within ${check.near_m} m of where Perseverance actually drove`)}</span></div>
      <div className="kv"><span>{t('このルートの最大の坂', 'Steepest slope on this route')}</span><b className={steepOk ? '' : 'ng'}>{check.route_max_slope.toFixed(1)}°</b></div>
      <div className="kv"><span>{t('探査車が走った坂（9割 / 最大）', 'Slopes the rover drove (90% / max)')}</span><b>{r.slope_p90.toFixed(1)}° / {r.slope_max.toFixed(1)}°</b></div>
      <div className="kv"><span>{t('坂が探査車の9割以内の区間', "Share within the rover's 90% slope")}</span><b>{Math.round(check.within_rover_share * 100)}%</b></div>
      <p className="muted">{t(`探査車の記録: 着陸から ${r.last_sol} 火星日、${r.km.toFixed(1)} km。坂は ${r.window_m}m ごとの高低差から計算。`, `Rover record: ${r.km.toFixed(1)} km over ${r.last_sol} sols. Slopes from the height change every ${r.window_m} m.`)}</p>
    </div>
  );
}

export function EvaCard({ eva, planH, longer }: { eva: EvaStats | null; planH: number; longer: number }) {
  const t = useT();
  if (!eva || eva.count === 0) return null;
  const max = Math.max(10, Math.ceil(eva.max_h), Math.ceil(planH));
  const bins = Array.from({ length: max }, (_, i) => eva.hours.filter((h) => h >= i && h < i + 1).length);
  const top = Math.max(...bins);
  const W = 260, H = 70, bw = W / max;
  return (
    <div className="card">
      <h4>{t('実際の船外活動と比べる', 'Compared with real EVAs')}</h4>
      <div className="big-line"><b>{Math.round(longer * 100)}%</b><span>{t(`過去の船外活動 ${eva.count} 回のうち、この計画（${planH.toFixed(1)} 時間）より長かった割合`, `of ${eva.count} past EVAs were longer than this plan (${planH.toFixed(1)} h)`)}</span></div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="hist" role="img" aria-label={t('船外活動の時間の分布', 'EVA durations')}>
        {bins.map((n, i) => (
          <rect key={i} x={i * bw + 1} y={H - (n / top) * H} width={bw - 2} height={(n / top) * H} className="hist-bar" />
        ))}
        <line x1={(planH / max) * W} x2={(planH / max) * W} y1={0} y2={H} className="hist-plan" />
        {[0, 2, 4, 6, 8, 10].filter((h) => h <= max).map((h) => (
          <text key={h} x={(h / max) * W} y={H + 12} className="hist-label">{h}h</text>
        ))}
      </svg>
      <div className="kv"><span>{t('中央値 / 最長', 'Median / longest')}</span><b>{eva.median_h.toFixed(1)} h / {eva.max_h.toFixed(1)} h</b></div>
      <div className="kv"><span>{t('Apollo の月面活動', 'Apollo moonwalks')}</span><b>{t(`${eva.apollo_hours.length} 回、最長 ${(eva.apollo_hours.at(-1) ?? 0).toFixed(1)} h`, `${eva.apollo_hours.length}, longest ${(eva.apollo_hours.at(-1) ?? 0).toFixed(1)} h`)}</b></div>
      <p className="muted">{t('出典: data.nasa.gov「Extra-vehicular Activity (EVA) - US and Russia」。多くは宇宙ステーションでの活動。', 'Source: data.nasa.gov "Extra-vehicular Activity (EVA) - US and Russia". Most are space-station EVAs.')}</p>
    </div>
  );
}
