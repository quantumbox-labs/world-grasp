// Landing sites of past missions, used as a shared "mission data" overlay.
// Longitudes are -180..180, east positive (matches Trek EQ tiles).
// ⚠ Coordinates are approximate (rounded published values); check before using in the final submission.
window.MISSIONS = {
  mars: [
    { name: 'Viking 1', year: 1976, agency: 'NASA', lat: 22.27, lon: -47.95 },
    { name: 'Viking 2', year: 1976, agency: 'NASA', lat: 47.64, lon: 134.29 },
    { name: 'Mars Pathfinder', year: 1997, agency: 'NASA', lat: 19.13, lon: -33.22 },
    { name: 'Spirit (MER-A)', year: 2004, agency: 'NASA', lat: -14.57, lon: 175.47 },
    { name: 'Opportunity (MER-B)', year: 2004, agency: 'NASA', lat: -1.95, lon: -5.53 },
    { name: 'Phoenix', year: 2008, agency: 'NASA', lat: 68.22, lon: -125.75 },
    { name: 'Curiosity (MSL)', year: 2012, agency: 'NASA', lat: -4.59, lon: 137.44 },
    { name: 'InSight', year: 2018, agency: 'NASA', lat: 4.50, lon: 135.62 },
    { name: 'Perseverance (M2020)', year: 2021, agency: 'NASA', lat: 18.44, lon: 77.45 },
    { name: 'Zhurong', year: 2021, agency: 'CNSA', lat: 25.07, lon: 109.93 },
  ],
  moon: [
    { name: 'Apollo 11', year: 1969, agency: 'NASA', lat: 0.674, lon: 23.473 },
    { name: 'Apollo 12', year: 1969, agency: 'NASA', lat: -3.012, lon: -23.422 },
    { name: 'Apollo 14', year: 1971, agency: 'NASA', lat: -3.645, lon: -17.471 },
    { name: 'Apollo 15', year: 1971, agency: 'NASA', lat: 26.132, lon: 3.634 },
    { name: 'Apollo 16', year: 1972, agency: 'NASA', lat: -8.973, lon: 15.498 },
    { name: 'Apollo 17', year: 1972, agency: 'NASA', lat: 20.191, lon: 30.772 },
    { name: "Chang'e 3", year: 2013, agency: 'CNSA', lat: 44.12, lon: -19.51 },
    { name: "Chang'e 4", year: 2019, agency: 'CNSA', lat: -45.44, lon: 177.60 },
    { name: 'Chandrayaan-3', year: 2023, agency: 'ISRO', lat: -69.37, lon: 32.32 },
    { name: 'SLIM', year: 2024, agency: 'JAXA', lat: -13.32, lon: 25.25 },
  ],
};

// Start points for route planning, per world.
window.WALK_PRESETS = {
  mars: [
    { id: 'jezero', name: 'Jezero Crater (Perseverance)', lat: 18.44, lon: 77.45, z: 9 },
    { id: 'gale', name: 'Gale Crater (Curiosity)', lat: -4.59, lon: 137.44, z: 9 },
    { id: 'arcadia', name: 'Arcadia Planitia（地下氷）', lat: 47.0, lon: -176.0, z: 9 },
  ],
  moon: [
    { id: 'a17', name: 'Apollo 17 Taurus-Littrow', lat: 20.191, lon: 30.772, z: 10 },
    { id: 'marius', name: 'Marius Hills Pit（縦穴）', lat: 14.09, lon: -56.77, z: 10 },
    { id: 'slim', name: 'SLIM (Shioli crater)', lat: -13.32, lon: 25.25, z: 10 },
  ],
  earth: [
    { id: 'daisetsu', name: '大雪山・白雲岳高原', lat: 43.65, lon: 142.90, z: 14 },
    { id: 'shikaribetsu', name: '然別 風穴地帯', lat: 43.27, lon: 143.10, z: 14 },
    { id: 'usu', name: '有珠山・昭和新山', lat: 42.54, lon: 140.86, z: 14 },
  ],
};

// Layer-control overlays for a world: past landing sites (+ Hokkaido analog sites on Earth).
window.missionOverlays = function (world) {
  const g = dataGroup();
  const list = world === 'earth'
    ? (window.EARTH_METRICS || []).map((e) => ({ name: e.name, lat: e.lat, lon: e.lon, agency: 'analog' }))
    : MISSIONS[world] || [];
  list.forEach((m) => L.circleMarker([m.lat, m.lon], {
    radius: 5, color: '#fff', weight: 1.5, fillColor: m.agency === 'JAXA' ? '#ff4d4f' : '#b37feb', fillOpacity: 0.95,
  }).bindTooltip(`${m.name}${m.year ? ` (${m.agency} ${m.year})` : ''}`).addTo(g));
  return { [world === 'earth' ? '◆ 北海道アナログ候補地' : '◆ 過去ミッション着陸地点']: g };
};
