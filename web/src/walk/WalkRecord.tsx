// #11 A UI: load a GPX walk (file picker or drag & drop) and show it in Hokkaido next to Jezero.
import { useMemo, useRef } from 'react';
import type { Core } from '../core';
import { PlanetMap, type Feature } from '../map/PlanetMap';
import { fmtH } from './geo';
import type { WalkImport } from './gpx';
import { useT } from '../i18n';

export function WalkImportCard({ rec, error, busy, onFile, onSample, onClear }: {
  rec: WalkImport | null; error: string | null; busy: boolean;
  onFile: (f: File) => void; onSample: () => void; onClear: () => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const s = rec?.summary;
  return (
    <div className="card walk-import" id="walk-import">
      <h4>{t('北海道を歩くと、火星の上で進む', 'Walk in Hokkaido, move on Mars')}</h4>
      <p className="muted">{t('歩いた記録（GPX）を読み込むと、同じ形・同じ距離の道を基地から Jezero に置き直し、火星なら帰れたかを判定します。GPX をここにドラッグ＆ドロップしても読み込めます。', 'Load a recorded walk (GPX): the same shape and distance is laid onto Jezero from the base, and the app checks whether you could have walked back on Mars. You can also drop a GPX file here.')}</p>
      <div className="btns">
        <button onClick={() => input.current?.click()} disabled={busy}>{t('GPX を選ぶ', 'Choose a GPX')}</button>
        <button onClick={onSample} disabled={busy}>{t('例（仮の自作データ）', 'Sample (made-up data)')}</button>
        {rec && <button onClick={onClear}>{t('やめる', 'Clear')}</button>}
      </div>
      <input ref={input} type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden aria-label={t('GPX ファイル', 'GPX file')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      {busy && <p className="muted">{t('読み込み中…', 'Loading…')}</p>}
      {error && <p className="warn">{error}</p>}
      {rec && s && (
        <>
          <div className={`walk-badge ${rec.synthetic ? 'synthetic' : 'measured'}`}>
            {rec.synthetic ? t('仮の自作データ（実測ではありません）', 'Made-up sample (not a recording)') : t('チームの実測', "Team's recording")}: {rec.name}
          </div>
          <div className="kv"><span>{t('歩いた距離', 'Distance walked')}</span><b>{s.km.toFixed(2)} km</b></div>
          <div className="kv"><span>{t('かかった時間（歩いていた時間）', 'Time (moving)')}</span><b>{fmtH(s.elapsed_h)} ({fmtH(s.moving_h)})</b></div>
          <div className="kv"><span>{t('登り / 下り（NASADEM）', 'Climb / descent (NASADEM)')}</span><b>{rec.area ? `${Math.round(s.climb_m)} m / ${Math.round(s.descent_m)} m` : t('標高データなし', 'No elevation data')}</b></div>
          <div className="kv"><span>{t('平地に直した速さ', 'Flat-ground speed')}</span><b className="measured-speed">{s.flat_kmh.toFixed(2)} km/h</b></div>
          {(s.flat_kmh > 5 || s.flat_kmh < 0.5) && <p className="muted">{t(`条件の「歩く速さ」は ${s.flat_kmh > 5 ? '上限の 5' : '下限の 0.5'} km/h を使います`, `The walking-speed setting uses its ${s.flat_kmh > 5 ? 'maximum of 5' : 'minimum of 0.5'} km/h`)}</p>}
          <p className="muted">
            {t(`速さは GPX の時刻と NASADEM の坂から求めた${rec.synthetic ? '値（仮データ）' : 'チームの実測'}で、上の「歩く速さ」に入れています。GPS の標高は使いません。`, `The speed comes from the GPX times and NASADEM slopes (${rec.synthetic ? 'sample data' : "the team's own measurement"}) and is set as the walking speed above. GPS elevation is not used.`)}
            {!rec.area && t(' この場所は標高データ（札幌市街）の範囲外なので、坂を平らとして計算しています。', ' This walk is outside the elevation data (central Sapporo), so slopes are taken as flat.')}
          </p>
        </>
      )}
    </div>
  );
}

/** Hokkaido side: the walk on aerial photos, with the walker in step with the Mars playback. */
export function EarthWalkPanel({ core, rec, walker }: { core: Core; rec: WalkImport; walker: [number, number] | null }) {
  const t = useT();
  const features = useMemo<Feature[]>(() => {
    const pts = rec.earth.map((p) => [p.lat, p.lon] as [number, number]);
    return [
      { kind: 'line', pts, color: '#000', weight: 7, opacity: 0.5 },
      { kind: 'line', pts, color: '#40a9ff', weight: 4 },
      { kind: 'point', lat: pts[0][0], lon: pts[0][1], color: '#ffffff', radius: 8, tooltip: t('スタート（火星の基地にあたる場所）', 'Start (where the Mars base would be)') },
    ];
  }, [rec]);
  const live = useMemo<Feature[]>(() => (walker ? [{ kind: 'walker', lat: walker[0], lon: walker[1], color: '#ff7a45' }] : []), [walker]);
  const fit = useMemo(() => {
    const la = rec.earth.map((p) => p.lat), lo = rec.earth.map((p) => p.lon);
    return { bounds: [[Math.min(...la), Math.min(...lo)], [Math.max(...la), Math.max(...lo)]] as [[number, number], [number, number]], seq: rec.earth.length + la[0] };
  }, [rec]);
  return (
    <div className="mapwrap earth-walk">
      <PlanetMap core={core} world="earth" view={[rec.earth[0].lat, rec.earth[0].lon, 15]} fit={fit} baseKey="gsiphoto" features={features} live={live} />
      <div className="maplabel">{t('北海道で歩いた道', 'The walk in Hokkaido')}{rec.synthetic ? t('（仮の自作データ）', ' (made-up sample)') : t('（チームの実測）', " (team's recording)")}</div>
    </div>
  );
}
