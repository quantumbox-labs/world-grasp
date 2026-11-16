// mapkit: shared map foundation for both challenge modes.
//   PlanetMap(el, opts) → one map pane that can switch Earth / Moon / Mars,
//   stacks base + overlay layers, keeps app layers (pins, routes) across switches,
//   shows a scale bar using the right planet radius, and can measure distances.
//
// Earth uses Web Mercator (EPSG3857); Moon/Mars Trek tiles are equirectangular (EPSG4326).
// Leaflet cannot change CRS on a live map, so a world switch rebuilds the L.Map
// on the same element and re-attaches everything registered through PlanetMap.
(function () {
  const EARTH_R_M = L.CRS.Earth.R; // radius Leaflet uses for L.circle / distance

  window.WORLDS = {
    earth: { label: '地球 Earth', icon: '🌏', R: 6371.0, gravity: 9.81, crs: L.CRS.EPSG3857,
             view: [43.2, 142.3, 7], minZoom: 2 },
    moon:  { label: '月 Moon', icon: '🌙', R: 1737.4, gravity: 1.62, crs: L.CRS.EPSG4326,
             view: [0, 0, 2], minZoom: 0 },
    mars:  { label: '火星 Mars', icon: '🔴', R: 3389.5, gravity: 3.72, crs: L.CRS.EPSG4326,
             view: [18.38, 77.58, 6], minZoom: 0 },
  };

  // Great-circle distance in km on a given body.
  window.distanceKm = function (world, a, b) {
    const r = Math.PI / 180, R = WORLDS[world].R;
    const lat1 = a.lat * r, lat2 = b.lat * r;
    const dLat = lat2 - lat1, dLon = ((b.lng ?? b.lon) - (a.lng ?? a.lon)) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  // L.circle radius is in "Earth metres"; convert a distance on another body.
  window.kmToLeafletM = (world, km) => (km / WORLDS[world].R) * EARTH_R_M;

  // Elevation lookup (m) at a point. Moon/Mars: Trek ImageServer identify. Earth: GSI DEM API.
  const ELEV = {
    moon: (lat, lon) => `https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer/identify?geometry=${encodeURIComponent(JSON.stringify({ x: lon, y: lat }))}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`,
    mars: (lat, lon) => `https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer/identify?geometry=${encodeURIComponent(JSON.stringify({ x: lon, y: lat }))}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`,
    earth: (lat, lon) => `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon}&lat=${lat}&outtype=JSON`,
  };
  const elevCache = new Map();
  window.getElevation = async function (world, lat, lon) {
    const key = `${world}:${lat.toFixed(5)}:${lon.toFixed(5)}`;
    if (elevCache.has(key)) return elevCache.get(key);
    const p = fetch(ELEV[world](lat, lon)).then((r) => r.json()).then((j) => {
      const v = world === 'earth' ? j.elevation : j.value;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }).catch(() => null);
    elevCache.set(key, p);
    return p;
  };

  // Scale bar that uses the current body's radius (L.control.scale assumes Earth).
  const PlanetScale = L.Control.extend({
    options: { position: 'bottomleft', maxWidth: 120 },
    initialize(pm, opts) { this._pm = pm; L.setOptions(this, opts); },
    onAdd(map) {
      this._el = L.DomUtil.create('div', 'planet-scale');
      map.on('move zoom resize', this._update, this);
      setTimeout(() => this._update(), 0);
      return this._el;
    },
    onRemove(map) { map.off('move zoom resize', this._update, this); },
    _update() {
      const map = this._map; if (!map || !map._loaded) return;
      const y = map.getSize().y / 2, w = this.options.maxWidth;
      const a = map.containerPointToLatLng([0, y]), b = map.containerPointToLatLng([w, y]);
      const km = distanceKm(this._pm.world, a, b);
      const nice = niceNumber(km);
      const px = Math.round(w * nice / km);
      this._el.style.width = `${px}px`;
      this._el.textContent = nice >= 1 ? `${nice} km` : `${Math.round(nice * 1000)} m`;
    },
  });
  function niceNumber(x) {
    const p = 10 ** Math.floor(Math.log10(x)), d = x / p;
    return (d >= 5 ? 5 : d >= 2 ? 2 : 1) * p;
  }

  // Cursor coordinate readout.
  const CoordReadout = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd(map) {
      const el = L.DomUtil.create('div', 'coord-readout');
      map.on('mousemove', (e) => { el.textContent = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`; });
      return el;
    },
  });

  /**
   * @param {string|HTMLElement} el
   * @param {object} opts
   *   world: 'earth'|'moon'|'mars'
   *   base: default base key per world, e.g. { mars: 'viking' }
   *   dataOverlays(world, pm): extra named overlays for the layer control, e.g. mission pins
   *   collapsed: layer control collapsed (default true)
   */
  window.PlanetMap = function (el, opts = {}) {
    const listeners = []; // [event, fn] re-attached on rebuild
    const appLayers = []; // layers kept across rebuilds
    const worldHooks = [];
    const pm = {
      world: null, map: null,
      on(ev, fn) { listeners.push([ev, fn]); if (pm.map) pm.map.on(ev, fn); return pm; },
      onWorld(fn) { worldHooks.push(fn); return pm; },
      // Register an app layer (e.g. L.layerGroup) that survives world switches.
      keep(layer) { appLayers.push(layer); if (pm.map) layer.addTo(pm.map); return layer; },
      setWorld,
      flyTo(lat, lon, z, o) { pm.map.flyTo([lat, lon], z ?? pm.map.getZoom(), { duration: 1.0, ...o }); },
      invalidate() { pm.map && pm.map.invalidateSize(); },
      distanceKm: (a, b) => distanceKm(pm.world, a, b),
      kmToLeafletM: (km) => kmToLeafletM(pm.world, km),
      elevation: (lat, lon) => getElevation(pm.world, lat, lon),
    };

    function build(world, view) {
      const B = WORLDS[world];
      const map = L.map(el, { crs: B.crs, minZoom: B.minZoom, worldCopyJump: world === 'earth' });
      map.setView([view[0], view[1]], view[2]);

      const base = {}, over = {};
      const baseDefs = LAYERS[world] || {};
      for (const [k, d] of Object.entries(baseDefs)) base[d.name] = makeTile(d);
      for (const d of Object.values(LAYERS[`${world}Overlay`] || {})) over[d.name] = makeTile(d);
      Object.assign(over, opts.dataOverlays ? opts.dataOverlays(world, pm) : {});
      const baseKey = opts.base?.[world] || Object.keys(baseDefs)[0];
      (base[baseDefs[baseKey]?.name] || Object.values(base)[0]).addTo(map);
      // Data overlays default to visible.
      for (const [name, l] of Object.entries(over)) if (l.options?.defaultOn) l.addTo(map);
      L.control.layers(base, over, { collapsed: opts.collapsed ?? true }).addTo(map);
      new PlanetScale(pm).addTo(map);
      new CoordReadout().addTo(map);

      listeners.forEach(([ev, fn]) => map.on(ev, fn));
      appLayers.forEach((l) => l.addTo(map));
      return map;
    }

    function setWorld(world, view) {
      if (world === pm.world && !view) return pm;
      const prev = pm.world;
      if (pm.map) {
        appLayers.forEach((l) => pm.map.removeLayer(l));
        pm.map.remove();
      }
      pm.world = world;
      pm.map = build(world, view || WORLDS[world].view);
      worldHooks.forEach((fn) => fn(world, prev));
      return pm;
    }

    setWorld(opts.world || 'earth', opts.view);
    return pm;
  };

  // A layer group flagged to be on by default when handed to dataOverlays.
  window.dataGroup = () => { const g = L.layerGroup(); g.options.defaultOn = true; return g; };
})();
