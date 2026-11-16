// Writes a SYNTHETIC sample walk (not a recording) so the GPX import can be built and tested before
// the team's real Sapporo walk: Maruyama Park station → Maruyama summit → back, about 3.7 km with a
// ~190 m climb. Only lat/lon/time are written (the app ignores GPS elevation anyway; it takes
// elevation from NASADEM). Times assume ~4 km/h on the flat, slower uphill.
//   node scripts/make-sample-gpx.mjs
import fs from 'node:fs';

// Hand-placed waypoints along the public paths (approximate).
const WP = [
  [43.05455, 141.31905], // 円山公園駅
  [43.05430, 141.31520], // 円山公園 入口
  [43.05380, 141.31190], // 円山公園 奥
  [43.05150, 141.30830], // 八十八ヶ所 登山口
  [43.04970, 141.30550],
  [43.04800, 141.30300],
  [43.04660, 141.30110],
  [43.04580, 141.29990], // 円山 山頂（NASADEM の最高点付近）
];
const route = [...WP, ...WP.slice(0, -1).reverse()];
const R = 6371000, K = Math.PI / 180;
const dist = (a, b) => Math.hypot((b[1] - a[1]) * K * R * Math.cos(a[0] * K), (b[0] - a[0]) * K * R);
const pts = [];
for (let i = 0; i < route.length - 1; i++) {
  const a = route[i], b = route[i + 1], n = Math.max(1, Math.round(dist(a, b) / 10));
  for (let j = 0; j < n; j++) pts.push([a[0] + (b[0] - a[0]) * (j / n), a[1] + (b[1] - a[1]) * (j / n), i]);
}
pts.push([...route.at(-1), route.length - 1]);
// Slower on the climbing legs (index 3–6 up, 7–10 back down).
let t = Date.parse('2026-11-14T19:00:00+09:00');
const out = pts.map((p, k) => {
  if (k > 0) {
    const leg = pts[k - 1][2];
    const kmh = leg >= 3 && leg <= 6 ? 2.4 : leg >= 7 && leg <= 10 ? 3.2 : 4.2;
    t += (dist(pts[k - 1], p) / (kmh * 1000)) * 3600 * 1000;
  }
  return `      <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"><time>${new Date(t).toISOString().replace('.000', '')}</time></trkpt>`;
});
const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WALKBACK make-sample-gpx.mjs" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>SYNTHETIC sample: Sapporo Maruyama round trip</name>
    <desc>仮の自作データ（実測ではありません）。チームの実測 GPX に置き換えてください。Made-up sample, not a recording.</desc>
  </metadata>
  <trk>
    <name>Maruyama Park station - Maruyama summit - back (synthetic)</name>
    <trkseg>
${out.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
fs.writeFileSync('web/public/data/walks/sample-sapporo-maruyama-SYNTHETIC.gpx', gpx);
let km = 0; for (let i = 1; i < pts.length; i++) km += dist(pts[i - 1], pts[i]) / 1000;
console.log(`${pts.length} points, ${km.toFixed(2)} km, ${((t - Date.parse('2026-11-14T19:00:00+09:00')) / 60000).toFixed(0)} min`);
