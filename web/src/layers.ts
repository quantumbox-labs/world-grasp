// Tile source registry, grouped by world (ported from app/js/layers.js).
//   LAYERS[world]            → base layers (radio buttons)
//   LAYERS[world + 'Overlay'] → overlays (checkboxes)
// URLs were checked on 2026-11-14 (HTTP 200 + CORS *), see docs/data/*.md.
import L from 'leaflet';

export interface LayerDef {
  name: string; url: string; opts: L.TileLayerOptions;
  /** Bundled copy under web/public/tiles (scripts/fetch-walk-tiles.mjs): `<dir>/{z}/{y}/{x}.<ext>`. Tried first. */
  local?: string;
}

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const TREK = 'https://trek.nasa.gov/tiles';
// GIBS daily layers need a date; use a recent snow-free summer date for Hokkaido.
const GIBS_DATE = '2026-08-01';

// Trek EQ tiles (equirectangular, Leaflet EPSG4326). Extension is fixed per layer.
const trek = (body: string, layer: string, ext: string, maxNativeZoom: number, extra: L.TileLayerOptions = {}): Omit<LayerDef, 'name'> => ({
  url: `${TREK}/${body}/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`,
  opts: { tms: false, maxNativeZoom, maxZoom: 14, noWrap: true,
          attribution: 'NASA Solar System Treks', ...extra },
});
const ov = (def: Omit<LayerDef, 'name'>, opacity = 0.6) => ({ ...def, opts: { ...def.opts, opacity } });

export const LAYERS: Record<string, Record<string, LayerDef>> = {
  earth: {
    's2': { name: 'Sentinel-2 cloudless (ESA/EOX)',
      url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
      opts: { maxNativeZoom: 15, maxZoom: 17, attribution: 'Sentinel-2 cloudless by EOX (Copernicus data)' } },
    'gsi': { name: '地理院地図 標準',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
      opts: { maxNativeZoom: 18, maxZoom: 18, attribution: '国土地理院' } },
    'gsiphoto': { name: '地理院 航空写真',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', local: 'earth-gsiphoto/{z}/{y}/{x}.jpg',
      opts: { maxNativeZoom: 18, maxZoom: 18, attribution: '国土地理院' } },
    'modis': { name: `MODIS Terra True Color (${GIBS_DATE})`,
      url: `${GIBS}/MODIS_Terra_CorrectedReflectance_TrueColor/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      opts: { maxNativeZoom: 9, attribution: 'NASA GIBS' } },
    'bluemarble': { name: 'Blue Marble Shaded Relief',
      url: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
      opts: { maxNativeZoom: 8, attribution: 'NASA GIBS' } },
  },
  earthOverlay: {
    'relief': { name: 'ASTER GDEM 陰影起伏',
      url: `${GIBS}/ASTER_GDEM_Greyscale_Shaded_Relief/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg`,
      opts: { maxNativeZoom: 12, opacity: 0.5, attribution: 'NASA/METI ASTER GDEM via GIBS' } },
    'slope': { name: '地理院 傾斜量図',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png',
      opts: { maxNativeZoom: 15, minNativeZoom: 3, opacity: 0.5, attribution: '国土地理院' } },
    'geology': { name: '産総研 シームレス地質図V2',
      url: 'https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png?layer=glfs',
      opts: { maxNativeZoom: 13, opacity: 0.6, attribution: '産総研地質調査総合センター' } },
    'lst': { name: `MODIS 地表温度 昼 (${GIBS_DATE})`,
      url: `${GIBS}/MODIS_Terra_Land_Surface_Temp_Day/default/${GIBS_DATE}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
      opts: { maxNativeZoom: 7, opacity: 0.6, attribution: 'NASA GIBS' } },
    'ndvi': { name: `MODIS NDVI 8日 (${GIBS_DATE})`,
      url: `${GIBS}/MODIS_Terra_NDVI_8Day/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
      opts: { maxNativeZoom: 9, opacity: 0.6, attribution: 'NASA GIBS' } },
  },

  moon: {
    'wac': { name: 'LRO WAC Mosaic', ...trek('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02', 'jpg', 8) },
    'kaguya': { name: 'かぐや TC Ortho (JAXA)', ...trek('Moon', 'Kaguya_TCortho_Mosaic_Global_4096ppd', 'png', 10,
                { attribution: 'JAXA SELENE/Kaguya via NASA Solar System Treks' }) },
    'lola': { name: 'LOLA Color Shaded Relief', ...trek('Moon', 'LRO_LOLA_ClrShade_Global_128ppd_v04', 'png', 5) },
  },
  moonOverlay: {
    'slope': { name: 'LOLA 傾斜 (16ppd)', ...ov(trek('Moon', 'LRO_LOLA_ClrSlope_Global_16ppd', 'png', 2)) },
    'slopehi': { name: 'LOLA+かぐや 傾斜 (60°S–60°N)', ...ov(trek('Moon', 'LRO_LOLAKaguya_ClrSlope_60N60S_512ppd', 'png', 10)) },
    'temp': { name: 'Diviner 平均表面温度', ...ov(trek('Moon', 'LRO_Diviner_ST_Avg_Clr_Global_32ppd', 'png', 3)) },
    'rock': { name: 'Diviner 岩石存在度', ...ov(trek('Moon', 'Diviner_avg_RockAbundance', 'png', 6)) },
    'psr': { name: 'LOLA 南極 日照/永久影', ...ov(trek('Moon', 'LRO_LOLA_Illumination_SPole65S_240m_EQ', 'png', 5), 0.7) },
  },

  mars: {
    'viking': { name: 'Viking MDIM2.1 Color', ...trek('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 7), local: 'mars-viking/{z}/{y}/{x}.jpg' },
    'mola': { name: 'MOLA Color Shaded Relief', ...trek('Mars', 'Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg', 7), local: 'mars-mola/{z}/{y}/{x}.jpg' },
    'hrsc': { name: 'MOLA+HRSC Color Shade (ESA)', ...trek('Mars', 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw', 'jpg', 8,
              { attribution: 'NASA/ESA/DLR/FU Berlin via NASA Solar System Treks' }) },
    'themis': { name: 'THEMIS Day IR 100m', ...trek('Mars', 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', 'png', 9), local: 'mars-themis/{z}/{y}/{x}.png' },
    'ctx': { name: 'CTX Global Mosaic 5m (Caltech)',
      url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
      opts: { tileSize: 512, zoomOffset: -1, maxNativeZoom: 13, maxZoom: 15, noWrap: true,
              attribution: 'MRO CTX Global Mosaic (Caltech Murray Lab) via Esri' } },
  },
  marsOverlay: {
    // Jezero only: HiRISE 25 cm orthomosaic (PNG, levels up to 17; checked 2026-11-14 on the Mac).
    'hirise': { name: 'HiRISE 25cm Jezero（MRO）', ...ov(trek('Mars', 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png', 17,
                { maxZoom: 18, bounds: [[18.30, 77.20], [18.58, 77.62]], attribution: 'NASA/JPL-Caltech/UArizona HiRISE via NASA Solar System Treks' }), 1),
                local: 'mars-hirise/{z}/{y}/{x}.png' },
    'molaov': { name: 'MOLA カラー標高（半透明）', ...ov(trek('Mars', 'Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg', 7), 0.45) },
    'rough': { name: 'MOLA 表面粗さ', ...ov(trek('Mars', 'mola_roughness', 'png', 1)) },
    'ti': { name: 'TES 熱慣性', ...ov(trek('Mars', 'TES_Thermal_Inertia', 'png', 1)) },
    'dust': { name: 'TES ダスト被覆', ...ov(trek('Mars', 'TES_Dust', 'png', 1)) },
  },
};

// Tile layer that tries the bundled copy first and falls back to the network per tile.
const LocalFirst = L.TileLayer.extend({
  createTile(this: L.TileLayer & { _remote: string }, coords: L.Coords, done: L.DoneCallback) {
    const img = (L.TileLayer.prototype as unknown as { createTile: (c: L.Coords, d: L.DoneCallback) => HTMLImageElement })
      .createTile.call(this, coords, done);
    const remote = L.Util.template(this._remote, { ...coords, z: (this as unknown as { _getZoomForUrl: () => number })._getZoomForUrl(), s: 'a' });
    img.addEventListener('error', () => { if (img.src !== remote) img.src = remote; }, { once: true });
    return img;
  },
});

export const makeTile = (d: LayerDef): L.TileLayer => {
  if (!d.local) return L.tileLayer(d.url, d.opts);
  const layer = new (LocalFirst as unknown as new (u: string, o: L.TileLayerOptions) => L.TileLayer)(`./tiles/${d.local}`, d.opts);
  (layer as unknown as { _remote: string })._remote = d.url;
  return layer;
};
