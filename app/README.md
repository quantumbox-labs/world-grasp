# app — MVP prototype

Static site with no build step (Leaflet 1.9.4 from cdnjs). It deploys to GitHub Pages as is.

```bash
python3 -m http.server 8765 --directory app
```

- `#analogs`: #10 Earth Analogs. The Hokkaido map and the Moon/Mars map sit side by side, with 5-dimension scores and per-task weights.
- `#walk[/world/lat/lon/zoom]`: #11 Martian Map (WALKBACK). Route by clicking, return limit from O₂, slope-adjusted speed. Works on Mars, Moon and Earth (`#mars` is an alias).

| File | Contents |
|---|---|
| `js/layers.js` | Tile URLs (all checked on 11/14) |
| `js/earth-metrics.js` | **Generated** Hokkaido metrics for 15 sites (`scripts/compute_earth_metrics.py`) |
| `js/bodies.js` | 10 Moon/Mars targets, reference values, oxide compositions |
| `js/scoring.js` | 5-dimension similarity formulas, urban/cropland screening, weight profiles |
| `js/analogs.js` | #10 screen |
| `js/walkback.js` | #11 screen (`js/martian.js` is the old version and is no longer loaded) |
| `js/core/mapkit.js` | Shared map foundation, see below |
| `js/core/drawtools.js` | Pin / route toolbar, see below |
| `js/data/missions.js` | Past landing sites (Mars, Moon) overlay, route start presets |

## TODO
- [x] Replace placeholder scores with values calculated from data (GSI DEM slope, MODIS NDVI/LST/land cover, NASA POWER precipitation, GSJ lithology)
- [ ] Moon/Mars slopes and Mars temperatures are representative literature values (`approx`). Replace them with measurements where possible
- [ ] Shikaribetsu coordinates are approximate (the NDVI 0.875 forest pixel suggests they are off)
- [ ] Many sites match Deuteronilus best under the balanced profile, because Mars mid-latitude sun elevation is close to Hokkaido's. Consider lowering the lighting weight
- [x] #11: slow walking speed down on steep slopes (waypoint elevations from MOLA/LOLA/GSI, Tobler formula)
- [ ] #11: gravity correction, terrain between waypoints (sample DEM along each segment)
- [ ] Check that every newly added tile layer draws (could not be verified from the build sandbox)
- [ ] Check mission landing-site coordinates

## Shared map foundation (`js/core/`)
Both views are built on `PlanetMap`, so either challenge can be picked without redoing the map.

- `PlanetMap(el, opts)`: Earth (EPSG3857) ⇄ Moon/Mars (EPSG4326) switch, base + overlay layers from `LAYERS[world]` / `LAYERS[world+'Overlay']`, planet-aware scale bar, cursor coords, `distanceKm`, `getElevation` (Trek LOLA/MOLA identify, GSI DEM API). `WORLDS` holds radius and gravity (not to be confused with `BODIES`, the #10 target list).
- `DrawTools(pm)`: map toolbar for pins / route / undo / clear / GeoJSON export, stored per world.

```js
const pm = PlanetMap('my-map', { world: 'mars', dataOverlays: missionOverlays });
const dt = DrawTools(pm, { onChange: (state, world) => console.log(state.route) });
pm.setWorld('moon');   // rebuilds the map, keeps layers registered with pm.keep()
```

### Regenerating the metrics
```bash
python3 -m venv /tmp/v && /tmp/v/bin/pip install numpy pillow
/tmp/v/bin/python scripts/compute_earth_metrics.py   # → app/js/earth-metrics.js
```
