# Data survey summary (2026-11-14)

Everything here was checked with real requests. Details are in the files linked below.

## Conclusion: everything can be built browser-only, with no login and no API key

| Scoring dimension | Hokkaido side (Earth) | Moon/Mars side | Status |
|---|---|---|---|
| Topography (slope, roughness) | GSI elevation tiles `dem_png` (10 m, 5 m in parts) / AWS Terrain Tiles terrarium → compute slope in the browser | Trek LOLA ClrSlope / ClrRoughness tiles (colour only), MOLA roughness, MOLA/LOLA elevation via ImageServer `/identify` | ✅ |
| Geology | GSJ seamless geology tiles + `legend.json?point=lat,lon` (rock type and age) | Trek TES pyroxene, oxide compositions from papers | ✅ (body side is hand-entered literature values) |
| Temperature | GIBS `MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night/Day` (max z6). Asahidake in January ≈ 252 K | Diviner Tmax/Tmin via `/identify` (~60 km resolution), literature values | ✅ |
| Lighting | Solar position calculation (no data needed) | Trek south-pole PSR and pole shade, literature values | ⚠ weakest support in the papers |
| Regolith (bare ground, dryness) | GIBS `MODIS_Terra_L3_NDVI_16Day` + `MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual` (Barren = rgb 191,191,189), NASA POWER | Trek Diviner RockAbundance, TES thermal inertia | ✅ use the minimum NDVI within a 1–2 km radius |
| Candidate sites | JMA `volcano_list.json`, GVP (20 volcanoes in Hokkaido, 40 KB) | Artemis III 13 regions as GeoJSON (CORS `*`), Trek place-name data, 16 Mars sites | ✅ |

**GIBS pixels are colours, not raw values.** They must be converted back to values with the colormap XML.
**Tile axis order:** GSI and terrarium use `z/x/y`; GIBS, GSJ, EOX and Trek use `z/y/x`.

## Official challenge page
- The correct URL is https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/?tab=resources
- **Official resources:**
  - NASA: Earthdata Search, Worldview, PDS, LRO, Diviner
  - CSA: RADARSAT / RCM
  - ESA: Copernicus Data Space, Open Science Catalog
  - JAXA: G-Portal
- **Potential Considerations (excerpt), and how we answer them:**
  - "Show with data why a site is an analog" → the 5-dimension score
  - "Look beyond the famous sites (Antarctica, Atacama, Iceland, Hawaii)" → Hokkaido fits
  - "Show what is different, not only what matches" and "acknowledge Earth's limits (gravity, vacuum, radiation)" → show both in the UI
  - "Small areas match better than large ones" and "combine several datasets"
- Full text: [analogs-moon-mars.md §5](analogs-moon-mars.md)

## Partner-agency bonus
- **JAXA:** Kaguya TC ortho mosaic and LOLA+Kaguya slope, both available as Trek tiles. Marius Hills hole (a Kaguya discovery). G-Portal is in the official resources.
- **ESA:** Sentinel-2 cloudless (EOX tiles), and MOLA+HRSC blend on Trek.

## For #11 Martian Map
- **Base layers:** Trek Viking, MOLA, MOLA+HRSC, THEMIS DayIR 100 m, TES thermal inertia
- **High resolution:** CTX via `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}` (512px tiles, CORS `*`)
- **Elevation:** MOLA ImageServer `/identify` → slope cost for routes

## File index
| File | Contents |
|---|---|
| [analogs-earth-hokkaido.md](analogs-earth-hokkaido.md) | Hokkaido-side tiles/APIs, 13 candidate sites with measured values |
| [analogs-moon-mars.md](analogs-moon-mars.md) | Trek layers, Artemis/Mars sites, comparison values, official Resources |
| [../scoring-model.md](../scoring-model.md) | 5-dimension definitions, papers, weights (from Drive) |
| [earthdata.md](earthdata.md) | General Earthdata survey (POWER, FIRMS, IMERG, HLS …) |
| [nasa-apis.md](nasa-apis.md) | api.nasa.gov status (Mars Rover Photos and Landsat imagery are dead) |
| [data-nasa-gov.md](data-nasa-gov.md) | data.nasa.gov CKAN survey (mostly unrelated to this challenge) |
