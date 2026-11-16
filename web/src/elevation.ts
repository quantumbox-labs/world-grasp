// Elevation (m) at a point. Moon/Mars: Trek ImageServer identify (LOLA / MOLA). Earth: GSI DEM API.
import type { World } from './core';

const identify = (svc: string, lat: number, lon: number) =>
  `${svc}/identify?geometry=${encodeURIComponent(JSON.stringify({ x: lon, y: lat }))}` +
  '&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json';

const URLS: Record<World, (lat: number, lon: number) => string> = {
  moon: (lat, lon) => identify('https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer', lat, lon),
  mars: (lat, lon) => identify('https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer', lat, lon),
  earth: (lat, lon) => `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon}&lat=${lat}&outtype=JSON`,
};

const cache = new Map<string, Promise<number | null>>();

export function getElevation(world: World, lat: number, lon: number): Promise<number | null> {
  const key = `${world}:${lat.toFixed(5)}:${lon.toFixed(5)}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(URLS[world](lat, lon))
      .then((r) => r.json())
      .then((j) => {
        const n = parseFloat(world === 'earth' ? j.elevation : j.value);
        return Number.isFinite(n) ? n : null;
      })
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}
