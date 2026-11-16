// #11 Martian Map "WALKBACK": layered Mars map + EVA route with a return limit.
window.initMartian = function () {
  const MARS_R_KM = 3389.5;
  const map = L.map('mars-map', { crs: L.CRS.EPSG4326, minZoom: 0 }).setView([18.38, 77.58], 10);

  const base = {};
  for (const d of Object.values(LAYERS.mars)) base[d.name] = makeTile(d);
  base[LAYERS.mars.viking.name].addTo(map);
  L.control.layers(base, null, { collapsed: false }).addTo(map);
  // No L.control.scale: it assumes Earth's radius and would mislabel Mars distances.

  const PRESETS = {
    jezero: { name: 'Jezero Crater', lat: 18.38, lon: 77.58 },
    gale: { name: 'Gale Crater', lat: -5.4, lon: 137.8 },
    arcadia: { name: 'Arcadia Planitia', lat: 47.0, lon: -176.0 },
  };
  const presetSel = document.getElementById('mars-preset');
  for (const [k, p] of Object.entries(PRESETS)) presetSel.add(new Option(p.name, k));
  presetSel.onchange = () => { const p = PRESETS[presetSel.value]; map.flyTo([p.lat, p.lon], 10); };

  const pts = [];
  const line = L.polyline([], { color: '#ffd666', weight: 3 }).addTo(map);
  const markers = L.layerGroup().addTo(map);
  let limitCircle = null;

  const $ = (id) => document.getElementById(id);
  ['speed', 'o2', 'reserve'].forEach((id) => ($(id).oninput = update));
  $('clear-route').onclick = () => { pts.length = 0; update(); };
  $('undo-route').onclick = () => { pts.pop(); update(); };
  map.on('click', (e) => { pts.push(e.latlng); update(); });

  function hav(a, b) {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * MARS_R_KM * Math.asin(Math.sqrt(h));
  }
  // Leaflet's circle radius is in Earth metres; convert a Mars km radius to degrees, then to Earth metres.
  const marsKmToLeafletM = (km) => (km / MARS_R_KM) * 6378137;

  function update() {
    const speed = +$('speed').value, o2 = +$('o2').value, reserve = +$('reserve').value / 100;
    $('speed-v').textContent = speed; $('o2-v').textContent = o2; $('reserve-v').textContent = Math.round(reserve * 100);

    line.setLatLngs(pts);
    markers.clearLayers();
    pts.forEach((p, i) => L.circleMarker(p, {
      radius: i === 0 ? 8 : 5, color: '#fff', weight: 2, fillColor: i === 0 ? '#52c41a' : '#ffd666', fillOpacity: 1,
    }).bindTooltip(i === 0 ? '基地 / 着陸点' : `WP${i}`).addTo(markers));

    // Return limit: usable O2 split equally between going out and coming back.
    const usableH = o2 * (1 - reserve);
    const limitKm = (speed * usableH) / 2;
    if (limitCircle) map.removeLayer(limitCircle);
    if (pts.length) {
      limitCircle = L.circle(pts[0], { radius: marsKmToLeafletM(limitKm), color: '#ff4d4f', weight: 1, dashArray: '6 6', fill: false })
        .bindTooltip(`引き返し限界 ${limitKm.toFixed(1)} km`).addTo(map);
    }

    let out = 0, maxFromBase = 0, pnr = -1;
    for (let i = 1; i < pts.length; i++) {
      out += hav(pts[i - 1], pts[i]);
      const back = hav(pts[i], pts[0]); // straight-line return
      maxFromBase = Math.max(maxFromBase, back);
      if (pnr < 0 && (out + back) / speed > usableH) pnr = i;
    }
    const backKm = pts.length > 1 ? hav(pts[pts.length - 1], pts[0]) : 0;
    const totalH = (out + backKm) / speed;
    const ok = totalH <= usableH;
    $('route-stats').innerHTML = pts.length < 2 ? '<p class="muted">地図をクリックしてルートを置く（最初の点が基地）</p>' : `
      <div class="kv"><span>往路</span><b>${out.toFixed(2)} km</b></div>
      <div class="kv"><span>帰路（直線）</span><b>${backKm.toFixed(2)} km</b></div>
      <div class="kv"><span>所要時間</span><b>${totalH.toFixed(1)} h</b></div>
      <div class="kv"><span>使えるO₂</span><b>${usableH.toFixed(1)} h</b></div>
      <div class="verdict ${ok ? 'ok' : 'ng'}">${ok ? '✅ 帰還できる' : `⛔ WP${pnr} で引き返し限界を超える`}</div>
      <p class="warn">⚠ 斜面・地形による速度低下は未実装（平地の直線距離）</p>`;
  }
  update();

  return { invalidate: () => map.invalidateSize() };
};
