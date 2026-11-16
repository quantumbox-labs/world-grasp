// Moon/Mars reference targets. Sources: docs/data/analogs-moon-mars.md.
//  - lat/lon: Trek IAU names / Artemis III A3_Named_regions centroid (east-positive, -180..180)
//  - tmin/tmax (K): Moon = Diviner tbol ImageServer (~60 km cells, regional only);
//                   Mars = literature ranges (approx.)
//  - slope_mean_deg: literature/landing constraints (approx.) — Trek slope is colour-only, no raw values
//  - oxides wt% [SiO2, FeO(T), TiO2, Al2O3, MgO, CaO]: representative literature compositions (approx.)
// Every value marked approx: true is a representative figure, not a measurement at that point.
window.BODIES = [
  { id: 'mons_mouton', world: 'moon', name: 'Mons Mouton Plateau', ja: 'モンス・ムートン台地（南極）',
    lat: -85.43, lon: 31.74, kind: 'Artemis III 候補（2024 の9地域）', task: ['landing', 'ice', 'polar'],
    tmin: 76, tmax: 252, slope_mean_deg: 8, oxides: 'lunar_highland',
    src: 'A3_Named_regions centroid; Diviner tbol; slope: Artemis landing limit ~8–10°' },
  { id: 'malapert', world: 'moon', name: 'Malapert Massif', ja: 'マラパート山塊（南極）',
    lat: -85.99, lon: -0.24, kind: 'Artemis III 候補', task: ['landing', 'polar'],
    tmin: 75, tmax: 296, slope_mean_deg: 12, oxides: 'lunar_highland',
    src: 'A3_Named_regions centroid; Diviner tbol; massif flanks steeper (approx.)' },
  { id: 'shackleton', world: 'moon', name: 'Shackleton (floor, PSR)', ja: 'シャクルトン・クレーター（永久影）',
    lat: -89.63, lon: 132.32, kind: '永久影・水氷', task: ['ice'],
    tmin: 42, tmax: 91, slope_mean_deg: 15, oxides: 'lunar_highland',
    src: 'Trek place names; Diviner tbol' },
  { id: 'marius', world: 'moon', name: 'Marius Hills Hole', ja: 'マリウス丘の縦穴（かぐや発見）',
    lat: 14.09, lon: -56.77, kind: '溶岩チューブ天窓（JAXA SELENE）', task: ['caves', 'base'],
    tmin: 97, tmax: 392, slope_mean_deg: 4, oxides: 'lunar_mare_basalt',
    src: 'Haruyama et al. 2009; Kaku et al. 2017; Diviner tbol' },
  { id: 'compton', world: 'moon', name: 'Compton–Belkovich', ja: 'コンプトン・ベルコビッチ（珪長質ドーム）',
    lat: 61.0, lon: 99.5, kind: '珪長質火山', task: ['geology'],
    tmin: 90, tmax: 330, slope_mean_deg: 12, oxides: 'lunar_silicic', approx: true,
    src: 'Jolliff et al. 2011 (silicic volcanism); temps approx. for 61°N' },
  { id: 'arcadia', world: 'mars', name: 'Arcadia Planitia', ja: 'アルカディア平原',
    lat: 47.19, lon: -175.69, kind: '有人着陸の有力候補（浅部地下氷）', task: ['ice', 'landing'],
    tmin: 150, tmax: 250, slope_mean_deg: 2, oxides: 'mars_basalt', approx: true,
    src: 'SWIM; Bramson et al. 2015; temps: literature range' },
  { id: 'deuteronilus', world: 'mars', name: 'Deuteronilus Mensae', ja: 'デウテロニルス台地（氷河地形）',
    lat: 45.11, lon: 23.92, kind: '有人探査地域候補', task: ['ice'],
    tmin: 150, tmax: 250, slope_mean_deg: 10, oxides: 'mars_basalt', approx: true,
    src: 'First Landing Site Workshop 2015 EZ list' },
  { id: 'jezero', world: 'mars', name: 'Jezero Crater', ja: 'ジェゼロ・クレーター',
    lat: 18.41, lon: 77.69, kind: 'Perseverance・古湖デルタ', task: ['astrobio', 'traverse'],
    tmin: 180, tmax: 270, slope_mean_deg: 5, oxides: 'mars_olivine_basalt', approx: true,
    src: 'MEDA; Farley et al. 2022 (olivine-rich floor)' },
  { id: 'mawrth', world: 'mars', name: 'Mawrth Vallis', ja: 'マウルス谷（粘土・熱水変質）',
    lat: 22.43, lon: -16.97, kind: '粘土鉱物', task: ['astrobio', 'geology'],
    tmin: 180, tmax: 280, slope_mean_deg: 6, oxides: 'mars_clay', approx: true,
    src: 'Loizeau et al. 2007; Bishop et al. 2008' },
  { id: 'arsia', world: 'mars', name: 'Arsia Mons skylights', ja: 'アルシア山の天窓',
    lat: -8.26, lon: -120.09, kind: '溶岩チューブ天窓', task: ['caves'],
    tmin: 160, tmax: 250, slope_mean_deg: 5, oxides: 'mars_basalt', approx: true,
    src: 'Cushing et al. 2007' },
];

// [SiO2, FeO(T), TiO2, Al2O3, MgO, CaO] wt% — representative values (approx.)
window.OXIDES = {
  lunar_highland:      { label: '月 高地斜長岩質', v: [45.0, 5.0, 0.4, 27.0, 6.0, 16.0], src: 'Lunar Sourcebook (feldspathic highlands)' },
  lunar_mare_basalt:   { label: '月 海の玄武岩', v: [45.0, 20.0, 2.5, 9.0, 10.0, 10.0], src: 'Lunar Sourcebook (low-Ti mare basalt)' },
  lunar_silicic:       { label: '月 珪長質', v: [70.0, 3.0, 0.5, 13.0, 1.0, 2.0], src: 'Jolliff et al. 2011 (approx.)' },
  mars_basalt:         { label: '火星 玄武岩質地殻', v: [46.0, 18.0, 0.9, 10.0, 9.0, 7.0], src: 'Taylor & McLennan 2009 (avg. crust)' },
  mars_olivine_basalt: { label: '火星 カンラン石玄武岩', v: [42.0, 20.0, 0.6, 6.0, 18.0, 6.0], src: 'Jezero floor (approx.)' },
  mars_clay:           { label: '火星 Fe/Mg 粘土', v: [45.0, 20.0, 1.0, 8.0, 12.0, 3.0], src: 'Mawrth smectite (approx.)' },
  // Earth lithologies (Le Maitre 1976 average igneous compositions)
  basalt:              { label: '玄武岩', v: [49.2, 11.0, 1.8, 15.7, 6.7, 9.5], src: 'Le Maitre 1976' },
  basaltic_andesite:   { label: '玄武岩質安山岩', v: [54.0, 9.0, 1.1, 16.5, 5.0, 8.5], src: 'Le Maitre 1976 (interp.)' },
  andesite:            { label: '安山岩', v: [57.9, 7.0, 0.9, 17.0, 3.3, 6.8], src: 'Le Maitre 1976' },
  dacite:              { label: 'デイサイト', v: [65.0, 4.5, 0.6, 15.9, 1.8, 4.3], src: 'Le Maitre 1976' },
  rhyolite:            { label: '流紋岩', v: [72.8, 2.0, 0.3, 13.3, 0.4, 1.2], src: 'Le Maitre 1976' },
  sediment:            { label: '堆積物（組成のばらつき大）', v: [65.0, 5.0, 0.7, 14.0, 2.0, 3.0], src: 'generic (low confidence)' },
};

// Map GSJ lithology text → oxide class. Order matters (most specific first).
window.lithologyClass = function (ja) {
  if (!ja) return 'sediment';
  if (/玄武岩質安山岩|安山岩・玄武岩/.test(ja)) return 'basaltic_andesite';
  if (/玄武岩/.test(ja)) return 'basalt';
  if (/デイサイト|石英安山岩/.test(ja)) return 'dacite';
  if (/流紋岩/.test(ja)) return 'rhyolite';
  if (/安山岩/.test(ja)) return 'andesite';
  return 'sediment';
};

window.AXIAL_TILT = { earth: 23.44, moon: 1.54, mars: 25.19 };
