// DrawTools: pin / route drawing on a PlanetMap, kept separately per world.
//   const dt = DrawTools(pm, { onChange(state, world) {} });
//   dt.state()  → { pins: [{lat,lng,label,elev}], route: [{lat,lng,elev}] } for the current world
//   dt.setMode('pan'|'pin'|'route'), dt.undo(), dt.clear(), dt.exportGeoJSON()
(function () {
  window.DrawTools = function (pm, opts = {}) {
    const store = {}; // world → { pins, route }
    const S = () => (store[pm.world] ||= { pins: [], route: [] });
    let mode = opts.mode || 'pan';

    const group = pm.keep(L.layerGroup());
    const routeLine = L.polyline([], { color: '#ffd666', weight: 3 });

    // Toolbar control
    const Toolbar = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const el = L.DomUtil.create('div', 'leaflet-bar draw-toolbar');
        const btn = (m, label, title) => `<a href="#" data-m="${m}" title="${title}">${label}</a>`;
        el.innerHTML = btn('pan', '✋', '移動') + btn('pin', '📍', 'ピンを置く') + btn('route', '〰', 'ルートを引く')
          + btn('undo', '↶', '1つ戻す') + btn('clear', '🗑', 'このワールドの描画を消す') + btn('export', '⤓', 'GeoJSON で保存');
        L.DomEvent.disableClickPropagation(el);
        el.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          const m = a.dataset.m;
          if (m === 'undo') api.undo(); else if (m === 'clear') api.clear();
          else if (m === 'export') api.exportGeoJSON(); else api.setMode(m);
        }));
        this._el = el; paint(); return el;
      },
    });
    let toolbar = null;
    function attachToolbar() { toolbar = new Toolbar(); toolbar.addTo(pm.map); }
    function paint() {
      if (!toolbar?._el) return;
      toolbar._el.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.m === mode));
      pm.map.getContainer().style.cursor = mode === 'pan' ? '' : 'crosshair';
    }

    pm.on('click', (e) => {
      if (mode === 'pin') addPin(e.latlng);
      else if (mode === 'route') addRoutePoint(e.latlng);
    });
    pm.onWorld(() => { attachToolbar(); paint(); render(); emit(); });
    attachToolbar();

    function addPin(ll, label) {
      const p = { lat: ll.lat, lng: ll.lng, label: label || `P${S().pins.length + 1}`, elev: undefined };
      S().pins.push(p); fetchElev(p); render(); emit();
    }
    function addRoutePoint(ll) {
      const p = { lat: ll.lat, lng: ll.lng, elev: undefined };
      S().route.push(p); fetchElev(p); render(); emit();
    }
    function fetchElev(p) {
      const world = pm.world;
      getElevation(world, p.lat, p.lng).then((v) => {
        p.elev = v;
        if (world === pm.world) { render(); emit(); }
      });
    }
    const fmtElev = (v) => (v === undefined ? '標高 取得中…' : v === null ? '標高 —' : `標高 ${Math.round(v)} m`);

    function render() {
      group.clearLayers();
      const s = S();
      routeLine.setLatLngs(s.route); group.addLayer(routeLine);
      s.route.forEach((p, i) => L.circleMarker(p, {
        radius: i === 0 ? 8 : 5, color: '#fff', weight: 2,
        fillColor: i === 0 ? '#52c41a' : '#ffd666', fillOpacity: 1,
      }).bindTooltip(`${i === 0 ? '基地 / 出発点' : `WP${i}`}<br>${fmtElev(p.elev)}`).addTo(group));
      s.pins.forEach((p) => L.marker(p, { icon: pinIcon })
        .bindTooltip(`${p.label}<br>${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}<br>${fmtElev(p.elev)}`).addTo(group));
    }
    const pinIcon = L.divIcon({ className: 'pin-icon', html: '📍', iconSize: [24, 24], iconAnchor: [12, 22] });

    function emit() { opts.onChange && opts.onChange(S(), pm.world); }

    const api = {
      state: S,
      mode: () => mode,
      setMode(m) { mode = m; paint(); },
      undo() { const s = S(); if (mode === 'pin' ? s.pins.pop() : s.route.pop() ?? s.pins.pop()) { render(); emit(); } },
      clear() { store[pm.world] = { pins: [], route: [] }; render(); emit(); },
      setRoute(pts) { S().route = pts.map((p) => ({ lat: p.lat, lng: p.lng ?? p.lon })); S().route.forEach(fetchElev); render(); emit(); },
      exportGeoJSON() {
        const s = S();
        const fc = { type: 'FeatureCollection', properties: { body: pm.world }, features: [
          ...s.pins.map((p) => ({ type: 'Feature', properties: { kind: 'pin', label: p.label, elevation_m: p.elev ?? null },
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
          ...(s.route.length > 1 ? [{ type: 'Feature', properties: { kind: 'route', elevations_m: s.route.map((p) => p.elev ?? null) },
            geometry: { type: 'LineString', coordinates: s.route.map((p) => [p.lng, p.lat]) } }] : []),
        ] };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' }));
        a.download = `${pm.world}-plan.geojson`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    };
    render();
    return api;
  };
})();
