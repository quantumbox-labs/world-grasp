// #10 Earth Analogs: every Hokkaido site is scored (in Rust) against every Moon/Mars target.
import { useMemo, useState } from 'react';
import type { Core, World } from '../core';
import { PlanetMap, missionOverlay, type FlyTarget } from '../map/PlanetMap';
import { WorldTabs } from './WorldTabs';

const CONTROL_ID = 'sapporo';

export function AnalogsView({ core }: { core: Core }) {
  const [profileId, setProfileId] = useState('balanced');
  const [earthId, setEarthId] = useState<string | null>(null);
  const [bodyId, setBodyId] = useState<string | null>(null);
  const [bodyWorld, setBodyWorld] = useState<World>('mars');
  const [earthFly, setEarthFly] = useState<FlyTarget | null>(null);
  const [bodyFly, setBodyFly] = useState<FlyTarget | null>(null);

  const rankings = useMemo(() => core.rankAll(profileId), [core, profileId]);
  const profile = core.profiles.find((p) => p.id === profileId)!;
  const site = (id: string) => core.earthSites.find((e) => e.id === id)!;
  const body = (id: string) => core.bodies.find((b) => b.id === id)!;

  const selectBody = (id: string) => {
    const b = body(id);
    setBodyId(id);
    setBodyWorld(b.world);
    setBodyFly({ lat: b.lat, lon: b.lon, z: 5, seq: Date.now() });
  };
  const selectEarth = (id: string) => {
    const e = site(id);
    setEarthId(id);
    setEarthFly({ lat: e.lat, lon: e.lon, z: 13, seq: Date.now() });
    const r = rankings.find((x) => x.earth_id === id)!;
    const rk = r.ranks.find((x) => body(x.body_id).world === bodyWorld) ?? r.ranks[0];
    selectBody(rk.body_id);
  };

  // The Moon/Mars tab switches the whole comparison, not just the map: pick this site's best
  // match on that world, so the table and scores always describe what the map shows.
  const switchWorld = (w: World) => {
    setBodyWorld(w);
    const r = earthId ? rankings.find((x) => x.earth_id === earthId) : undefined;
    const best = r?.ranks.find((x) => body(x.body_id).world === w);
    if (best) selectBody(best.body_id);
    else if (bodyId && body(bodyId).world !== w) setBodyId(null);
  };
  const cur = earthId ? rankings.find((r) => r.earth_id === earthId) : undefined;
  const curE = earthId ? site(earthId) : undefined;
  const curB = bodyId ? body(bodyId) : undefined;
  const pair = cur && curB ? cur.ranks.find((p) => p.body_id === curB.id) : undefined;
  const effScore = (r: (typeof rankings)[number]) => {
    const rk = r.ranks.find((x) => body(x.body_id).world === bodyWorld) ?? r.ranks[0];
    return rk.excluded ? -1 : rk.total;
  };
  const ordered = [...rankings].sort((a, b) => effScore(b) - effScore(a));

  return (
    <section className="view">
      <aside className="panel">
        <label>目的別の重み
          <select id="profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {core.profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <ol id="site-list">
          {ordered.map((r) => {
            const e = site(r.earth_id), best = r.ranks.find((x) => body(x.body_id).world === bodyWorld) ?? r.ranks[0], b = body(best.body_id);
            return (
              <li key={e.id} onClick={() => selectEarth(e.id)}
                className={`${e.id === earthId ? 'active' : ''} ${e.id === CONTROL_ID ? 'control' : ''}`}>
                <div className="pair"><b>{e.name}</b>
                  <span>{best.excluded ? '除外（人工地表）' : `↔ ${core.world(b.world).icon} ${b.ja}`}</span></div>
                <div className="score">{best.excluded ? '–' : Math.round(best.total * 100)}</div>
              </li>
            );
          })}
        </ol>
        <div id="detail">
          {!cur || !curE || !curB || !pair ? (
            <p className="muted">北海道の地点を選ぶと、月・火星の候補との一致度を計算します（計算は Rust/WASM）</p>
          ) : (
            <>
              <h3>{curE.name}</h3>
              <p className="muted">{curE.lithology_ja ?? ''}{curE.age_ja ? `（${curE.age_ja}）` : ''}<br />
                標高 {curE.elev_m ?? '–'} m・起伏 {curE.relief_m ?? '–'} m（半径1km）</p>
              <div className="chips">
                {cur.ranks.filter((x) => body(x.body_id).world === curB.world).slice(0, 3).map((x) => {
                  const b = body(x.body_id);
                  return (
                    <button key={b.id} className={`chip ${b.id === curB.id ? 'on' : ''}`} onClick={() => selectBody(b.id)}>
                      {core.world(b.world).icon} {b.ja} <b>{Math.round(x.total * 100)}</b>
                    </button>
                  );
                })}
              </div>
              <div className="total">↔ {curB.ja}<br />一致度 <b>{Math.round(pair.total * 100)}</b><small>/100（{profile.label}）</small></div>
              {pair.excluded && <p className="warn">⛔ {pair.excluded}。参考値: {Math.round(pair.raw * 100)}</p>}
              {pair.dims.map((d) => (
                <div key={d.key}>
                  <div className="bar" title={d.formula}>
                    <label>{d.label} <small>×{profile.w[d.key]}</small></label>
                    <div className="track"><div className="fill" style={{ width: `${d.s * 100}%` }} /></div>
                    <span>{Math.round(d.s * 100)}</span>
                  </div>
                  <div className="why">{d.why}</div>
                </div>
              ))}
              <Similarity dims={pair.dims} />
              <p className="warn">地球では再現できない: 低重力（{core.world(curB.world).gravity} m/s²）・真空・宇宙放射線{curB.world === 'mars' ? '・CO₂の薄い大気' : ''}</p>
              <div className="btns">
                <a className="btn" target="_blank" rel="noopener" href={`https://maps.gsi.go.jp/#15/${curE.lat}/${curE.lon}/`}>🥾 北海道のこの場所で歩く練習（地図）</a>
                <a className="btn" href="#walk">🔴 火星で歩いて帰る練習</a>
                <a className="btn" href={curB.id === 'jezero' ? `#walk/mars/${curB.lat}/${curB.lon}/9` : '#walk'}>{core.world(curB.world).icon} 現地ルート計画</a>
              </div>
              <p className="muted">{curB.kind}。天体側の値: {curB.src}{curB.approx ? '（代表値）' : ''}</p>
            </>
          )}
        </div>
      </aside>
      <div className="maps">
        <PlanetMap core={core} world="earth" baseKey="s2" fly={earthFly}
          features={core.earthSites.map((e) => ({
            kind: 'point', lat: e.lat, lon: e.lon, radius: 7, tooltip: e.name, openTooltip: e.id === earthId,
            color: e.id === CONTROL_ID ? '#8c8c8c' : '#ff7a45', onClick: () => selectEarth(e.id),
          }))}>
          <div className="maplabel">地球 Hokkaido</div>
        </PlanetMap>
        <PlanetMap core={core} world={bodyWorld} view={[0, 0, 2]} fly={bodyFly}
          overlays={missionOverlay(core, bodyWorld)}
          features={core.bodies.filter((b) => b.world === bodyWorld).map((b) => ({
            kind: 'point', lat: b.lat, lon: b.lon, radius: b.id === bodyId ? 9 : 7, tooltip: b.ja,
            color: '#40a9ff', onClick: () => selectBody(b.id),
          }))}>
          <WorldTabs core={core} worlds={['mars', 'moon']} value={bodyWorld} onChange={switchWorld} className="maplabel tabs" />
        </PlanetMap>
      </div>
    </section>
  );
}

function Similarity({ dims }: { dims: { label: string; s: number }[] }) {
  const sorted = [...dims].sort((a, b) => b.s - a.s);
  return (
    <div className="sim"><b>似ている点</b> {sorted.slice(0, 2).map((d) => d.label).join('・')}
      ／ <b>違う点</b> {sorted.slice(-2).map((d) => d.label).join('・')}</div>
  );
}
