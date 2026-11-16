// 5-dimension analog similarity (docs/scoring-model.md), computed in the browser
// from EARTH_METRICS (measured) and BODIES (reference). Each dimension is 0–1.
(function () {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const r1 = (x) => (x == null ? '–' : Math.round(x * 10) / 10);

  function noonElevRange(lat, tilt) {
    const a = Math.abs(lat);
    const max = a <= tilt ? 90 : 90 - (a - tilt);
    const min = Math.max(0, 90 - (a + tilt));
    return [min, max];
  }

  const DIMS = {
    topography(e, b) {
      const d = Math.abs(e.slope_mean_deg - b.slope_mean_deg);
      return { s: Math.exp(-d / 10),
        why: `平均傾斜 ${r1(e.slope_mean_deg)}° vs ${b.slope_mean_deg}°（差 ${r1(d)}°）`,
        formula: 'exp(−|Δ平均傾斜| / 10°)' };
    },
    geology(e, b) {
      const ec = lithologyClass(e.lithology_ja);
      const ve = OXIDES[ec].v, vb = OXIDES[b.oxides].v;
      const d = Math.sqrt(ve.reduce((acc, v, i) => acc + (v - vb[i]) ** 2, 0));
      // Unconsolidated sediment has no single composition: cap its similarity (low confidence).
      const s = ec === 'sediment' ? Math.min(Math.exp(-d / 20), 0.3) : Math.exp(-d / 20);
      return { s,
        why: `${OXIDES[ec].label} vs ${OXIDES[b.oxides].label}（主要酸化物の距離 ${r1(d)} wt%）${ec === 'sediment' ? '・組成不明のため上限0.3' : ''}`,
        formula: 'exp(−‖Δ酸化物6種 wt%‖ / 20)' };
    },
    temperature(e, b) {
      const tmin = e.lst_night_jan_K ?? (e.t2m_min_jan_C + 273.15);
      const tmax = e.lst_day_aug_K ?? (e.t2m_max_aug_C + 273.15);
      const d = Math.hypot(tmin - b.tmin, tmax - b.tmax);
      return { s: Math.exp(-d / 150),
        why: `地表温度 ${Math.round(tmin)}–${Math.round(tmax)} K vs ${b.tmin}–${b.tmax} K`,
        formula: 'exp(−‖(ΔTmin, ΔTmax)‖ / 150 K)' };
    },
    lighting(e, b) {
      const [e0, e1] = noonElevRange(e.lat, AXIAL_TILT.earth);
      const [b0, b1] = noonElevRange(b.lat, AXIAL_TILT[b.world]);
      const d = Math.hypot(e0 - b0, e1 - b1);
      return { s: Math.exp(-d / 40),
        why: `南中高度 ${Math.round(e0)}–${Math.round(e1)}° vs ${Math.round(b0)}–${Math.round(b1)}°`,
        formula: 'exp(−‖Δ年間の南中高度(最小,最大)‖ / 40°)' };
    },
    regolith(e) {
      const bareNdvi = e.ndvi_min == null ? 0 : clamp((0.6 - e.ndvi_min) / 0.6);
      const bare = Math.max(bareNdvi, e.barren_frac ?? 0);
      const dry = clamp(1 - (e.precip_mm_yr ?? 2000) / 2000);
      return { s: 0.6 * bare + 0.4 * dry,
        why: `裸地 ${Math.round(bare * 100)}%（NDVI最小 ${e.ndvi_min ?? '–'}）・乾燥 ${Math.round(dry * 100)}%（年降水 ${e.precip_mm_yr ?? '–'} mm）`,
        formula: '0.6×裸地指数 + 0.4×乾燥指数' };
    },
  };

  window.DIM_LABELS = { topography: '地形', geology: '地質', temperature: '温度', lighting: '日照', regolith: '表土' };

  // Only "ice" and "landing" weights come from the Drive notes; others are team placeholders.
  window.PROFILES = {
    balanced: { label: 'バランス', w: { topography: .2, geology: .2, temperature: .2, lighting: .2, regolith: .2 } },
    ice:      { label: '氷・ISRU', w: { topography: .15, geology: .15, temperature: .40, lighting: .15, regolith: .15 } },
    landing:  { label: '着陸・走行', w: { topography: .50, geology: .125, temperature: .125, lighting: .125, regolith: .125 } },
    geology:  { label: '地質重視', w: { topography: .15, geology: .50, temperature: .10, lighting: .05, regolith: .20 } },
    caves:    { label: '洞窟・溶岩洞', w: { topography: .35, geology: .15, temperature: .35, lighting: .05, regolith: .10 } },
  };

  // Screening before scoring: an analog must be a natural surface (MODIS IGBP class at the site).
  const EXCLUDED_COVER = ['Urban and Built-up Lands', 'Croplands', 'Water Bodies'];
  window.screenOut = (e) => (EXCLUDED_COVER.includes(e.landcover_center)
    ? `人工・農地・水面のため除外（MODIS 土地被覆: ${e.landcover_center}）` : null);

  window.scorePair = function (e, b, w) {
    const dims = {};
    let sum = 0, wsum = 0;
    for (const k of Object.keys(DIMS)) {
      dims[k] = DIMS[k](e, b);
      sum += dims[k].s * w[k]; wsum += w[k];
    }
    const excluded = screenOut(e);
    return { total: excluded ? 0 : sum / wsum, raw: sum / wsum, excluded, dims };
  };

  window.rankBodies = function (e, w) {
    return BODIES.map((b) => ({ b, ...scorePair(e, b, w) })).sort((x, y) => y.total - x.total);
  };
})();
