// #11 Martian Map "WALKBACK": layered map + EVA route with a return limit.
// Works on Mars, Moon and Earth (Hokkaido = practice the same walk on an analog site).
window.initWalkback = function (params = {}) {
  const $ = (id) => document.getElementById(id);
  const pm = PlanetMap('walk-map', {
    world: params.world || 'mars',
    view: params.lat != null ? [+params.lat, +params.lon, +(params.z || 10)] : undefined, base: { mars: 'viking', earth: 's2' }, collapsed: false, dataOverlays: missionOverlays,
  });
  const limitLayer = pm.keep(L.layerGroup());
  const dt = DrawTools(pm, { mode: 'route', onChange: update });

  // World tabs + presets
  function renderWorld() {
    $('walk-tabs').innerHTML = ['mars', 'moon', 'earth'].map((w) =>
      `<button data-w="${w}" class="${w === pm.world ? 'on' : ''}">${WORLDS[w].icon} ${WORLDS[w].label}</button>`).join('');
    $('walk-tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => go({ world: b.dataset.w })));
    const sel = $('walk-preset');
    sel.innerHTML = '<option value="">— 地点を選ぶ —</option>';
    (WALK_PRESETS[pm.world] || []).forEach((p) => sel.add(new Option(p.name, p.id)));
  }
  $('walk-preset').onchange = (e) => {
    const p = (WALK_PRESETS[pm.world] || []).find((x) => x.id === e.target.value);
    if (p) pm.flyTo(p.lat, p.lon, p.z);
  };
  pm.onWorld(renderWorld);

  ['speed', 'o2', 'reserve'].forEach((id) => ($(id).oninput = () => update()));

  // Tobler's hiking function, normalised so flat ground = 1.0. Earth formula, used as a first guess.
  const slopeFactor = (s) => Math.exp(-3.5 * (Math.abs(s + 0.05) - 0.05));

  function seg(a, b) {
    const km = pm.distanceKm(a, b);
    const known = a.elev != null && b.elev != null && km > 0;
    const slope = known ? (b.elev - a.elev) / (km * 1000) : 0;
    return { km, slope, known, f: slopeFactor(slope) };
  }

  function update() {
    const speed = +$('speed').value, o2 = +$('o2').value, reserve = +$('reserve').value / 100;
    $('speed-v').textContent = speed; $('o2-v').textContent = o2; $('reserve-v').textContent = Math.round(reserve * 100);
    const pts = dt.state().route;

    // Return limit (flat ground): usable O2 split equally between going out and coming back.
    const usableH = o2 * (1 - reserve);
    const limitKm = (speed * usableH) / 2;
    limitLayer.clearLayers();
    if (pts.length) {
      L.circle(pts[0], { radius: pm.kmToLeafletM(limitKm), color: '#ff4d4f', weight: 1, dashArray: '6 6', fill: false })
        .bindTooltip(`引き返し限界（平地）${limitKm.toFixed(1)} km`).addTo(limitLayer);
    }

    let outKm = 0, outH = 0, pnr = -1, maxSlope = 0, unknown = 0;
    for (let i = 1; i < pts.length; i++) {
      const s = seg(pts[i - 1], pts[i]);
      outKm += s.km; outH += s.km / (speed * s.f);
      if (!s.known) unknown++;
      maxSlope = Math.max(maxSlope, Math.abs(s.slope));
      const back = seg(pts[i], pts[0]);
      if (pnr < 0 && outH + back.km / (speed * back.f) > usableH) pnr = i;
    }
    const back = pts.length > 1 ? seg(pts[pts.length - 1], pts[0]) : { km: 0, f: 1 };
    const backH = back.km / (speed * back.f);
    const totalH = outH + backH;
    const ok = totalH <= usableH;
    $('route-stats').innerHTML = pts.length < 2
      ? `<p class="muted">地図をクリックしてルートを置く（最初の点が基地）。📍でメモ用のピンも置けます。</p>`
      : `<div class="kv"><span>往路</span><b>${outKm.toFixed(2)} km / ${outH.toFixed(1)} h</b></div>
      <div class="kv"><span>帰路（直線）</span><b>${back.km.toFixed(2)} km / ${backH.toFixed(1)} h</b></div>
      <div class="kv"><span>最大傾斜</span><b>${(Math.atan(maxSlope) * 180 / Math.PI).toFixed(1)}°</b></div>
      <div class="kv"><span>所要時間 / 使えるO₂</span><b>${totalH.toFixed(1)} / ${usableH.toFixed(1)} h</b></div>
      <div class="verdict ${ok ? 'ok' : 'ng'}">${ok ? '✅ 帰還できる' : `⛔ WP${pnr > 0 ? pnr : pts.length - 1} で引き返し限界を超える`}</div>
      ${unknown ? `<p class="muted">標高未取得の区間 ${unknown} は平地として計算</p>` : ''}
      <p class="warn">⚠ 傾斜は経由点の標高差のみ（区間内の起伏は未考慮）。速度式は地球の Tobler 式を流用、重力 ${WORLDS[pm.world].gravity} m/s² の補正は未実装。</p>`;
  }

  function go(p = {}) {
    const world = p.world || pm.world;
    const view = p.lat != null ? [+p.lat, +p.lon, +(p.z || 10)] : undefined;
    if (world !== pm.world) pm.setWorld(world, view);
    else if (view) pm.flyTo(view[0], view[1], view[2]);
    update();
  }

  renderWorld();
  update();

  return { invalidate: () => pm.invalidate(), go };
};
