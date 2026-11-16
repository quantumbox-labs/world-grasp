// #10 Earth Analogs: every Hokkaido site is scored against every Moon/Mars target.
window.initAnalogs = function () {
  // Both panes are PlanetMaps (js/core/mapkit.js): layers, scale bar and Moon/Mars switching come from there.
  const earth = PlanetMap('earth-map', { world: 'earth', base: { earth: 's2' } });
  const body = PlanetMap('body-map', { world: 'mars', view: [20, 0, 1], dataOverlays: missionOverlays });
  const earthSites = earth.keep(L.layerGroup()), bodySites = body.keep(L.layerGroup());

  const bodyMarkers = {};
  function drawBodySites() {
    bodySites.clearLayers();
    BODIES.filter((b) => b.world === body.world).forEach((b) => {
      bodyMarkers[b.id] = L.circleMarker([b.lat, b.lon], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#40a9ff', fillOpacity: 0.9,
      }).bindTooltip(b.ja).on('click', () => selectBody(b.id)).addTo(bodySites);
    });
  }
  const setWorld = (world) => body.setWorld(world);

  // Moon / Mars toggle on the right pane
  const tabs = document.getElementById('body-tabs');
  function renderWorldTabs() {
    tabs.innerHTML = ['mars', 'moon'].map((w) =>
      `<button data-w="${w}" class="${w === body.world ? 'on' : ''}">${WORLDS[w].icon} ${WORLDS[w].label}</button>`).join('');
    tabs.querySelectorAll('button').forEach((b) => (b.onclick = () => body.setWorld(b.dataset.w)));
  }
  body.onWorld(() => { drawBodySites(); renderWorldTabs(); });

  const isControl = (e) => e.id === 'sapporo';
  const earthMarkers = {};
  EARTH_METRICS.forEach((e) => {
    earthMarkers[e.id] = L.circleMarker([e.lat, e.lon], {
      radius: 7, color: '#fff', weight: 2, fillColor: isControl(e) ? '#8c8c8c' : '#ff7a45', fillOpacity: 0.9,
    }).bindTooltip(e.name).on('click', () => selectEarth(e.id)).addTo(earthSites);
  });

  const profileSel = document.getElementById('profile');
  for (const [k, p] of Object.entries(PROFILES)) profileSel.add(new Option(p.label, k));
  profileSel.onchange = () => { renderList(); renderDetail(); };
  const W = () => PROFILES[profileSel.value].w;

  let curEarth = null, curBody = null;
  const listEl = document.getElementById('site-list');

  function renderList() {
    const ranked = EARTH_METRICS.map((e) => ({ e, best: rankBodies(e, W())[0] }))
      .sort((a, b) => b.best.total - a.best.total);
    listEl.innerHTML = '';
    ranked.forEach(({ e, best }) => {
      const li = document.createElement('li');
      li.className = (e.id === curEarth?.id ? 'active' : '') + (isControl(e) ? ' control' : '');
      li.innerHTML = best.excluded
        ? `<div class="pair"><b>${e.name}</b><span>除外（人工地表）</span></div><div class="score">–</div>`
        : `<div class="pair"><b>${e.name}</b><span>↔ ${best.b.world === 'moon' ? '🌙' : '🔴'} ${best.b.ja}</span></div>
        <div class="score">${Math.round(best.total * 100)}</div>`;
      li.onclick = () => selectEarth(e.id);
      listEl.appendChild(li);
    });
  }

  function renderDetail() {
    const el = document.getElementById('detail');
    if (!curEarth) { el.innerHTML = '<p class="muted">北海道の地点を選ぶと、月・火星の候補との一致度を計算します</p>'; return; }
    const ranks = rankBodies(curEarth, W());
    const r = ranks.find((x) => x.b.id === curBody.id);
    const prof = PROFILES[profileSel.value];
    const entries = Object.entries(r.dims);
    const sorted = [...entries].sort((a, b) => b[1].s - a[1].s);
    const bars = entries.map(([k, d]) => `
      <div class="bar" title="${d.formula}"><label>${DIM_LABELS[k]} <small>×${prof.w[k]}</small></label>
        <div class="track"><div class="fill" style="width:${d.s * 100}%"></div></div><span>${Math.round(d.s * 100)}</span></div>
      <div class="why">${d.why}</div>`).join('');
    const top3 = ranks.slice(0, 3).map((x) => `
      <button class="chip ${x.b.id === curBody.id ? 'on' : ''}" data-b="${x.b.id}">
        ${x.b.world === 'moon' ? '🌙' : '🔴'} ${x.b.ja} <b>${Math.round(x.total * 100)}</b></button>`).join('');
    el.innerHTML = `
      <h3>${curEarth.name}</h3>
      <p class="muted">${curEarth.lithology_ja ?? ''}${curEarth.age_ja ? '（' + curEarth.age_ja + '）' : ''}<br>
        標高 ${curEarth.elev_m ?? '–'} m・起伏 ${curEarth.relief_m} m（半径1km）</p>
      <div class="chips">${top3}</div>
      ${r.excluded ? `<p class="warn">⛔ ${r.excluded}。参考値: ${Math.round(r.raw * 100)}</p>` : ''}
      <div class="total">↔ ${curBody.ja}<br>一致度 <b>${Math.round(r.total * 100)}</b><small>/100（${prof.label}）</small></div>
      ${bars}
      <div class="sim"><b>似ている点</b> ${sorted.slice(0, 2).map(([k]) => DIM_LABELS[k]).join('・')}
        ／ <b>違う点</b> ${sorted.slice(-2).map(([k]) => DIM_LABELS[k]).join('・')}</div>
      <p class="warn">地球では再現できない: 低重力・真空・宇宙放射線${curBody.world === 'mars' ? '・CO₂の薄い大気' : ''}</p>
      <div class="btns">
        <a class="btn" href="#walk/earth/${curEarth.lat}/${curEarth.lon}/14">🥾 北海道で歩く練習</a>
        <a class="btn" href="#walk/${curBody.world}/${curBody.lat}/${curBody.lon}/10">${WORLDS[curBody.world].icon} 現地ルート計画</a>
      </div>
      <p class="muted">${curBody.kind}。天体側の値: ${curBody.src}${curBody.approx ? '（代表値）' : ''}</p>`;
    el.querySelectorAll('.chip').forEach((c) => (c.onclick = () => selectBody(c.dataset.b)));
  }

  function selectEarth(id) {
    curEarth = EARTH_METRICS.find((e) => e.id === id);
    earth.flyTo(curEarth.lat, curEarth.lon, 13);
    earthMarkers[id].openTooltip();
    selectBody(rankBodies(curEarth, W())[0].b.id);
    renderList();
  }

  function selectBody(id) {
    curBody = BODIES.find((b) => b.id === id);
    setWorld(curBody.world);
    body.flyTo(curBody.lat, curBody.lon, 5);
    renderDetail();
  }

  drawBodySites();
  renderWorldTabs();
  renderList();
  renderDetail();

  return { invalidate: () => { earth.invalidate(); body.invalidate(); } };
};
