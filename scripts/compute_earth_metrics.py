#!/usr/bin/env python3
"""Compute Earth-side raw metrics for Hokkaido candidate sites.

Sources (no login, all fetched live):
  - GSI dem_png z14 (~7 m/px here)        -> slope histogram, mean slope, relief
  - NASA GIBS MODIS NDVI 16-day (z9)       -> min / median NDVI within radius
  - NASA GIBS MODIS IGBP land cover (z8)   -> barren fraction within radius
  - NASA GIBS MODIS LST monthly (z6)       -> Jan night / Aug day surface temperature (K)
  - NASA POWER climatology                 -> annual precipitation (mm), Jan T2M min
  - GSJ seamless geology legend API        -> lithology text

Output: app/js/earth-metrics.js  (window.EARTH_METRICS = [...])

Usage: python3 scripts/compute_earth_metrics.py [cache_dir]
Needs numpy + pillow.
"""
import io, json, math, os, sys, time, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('TMPDIR', '/tmp'), 'haf-cache')
os.makedirs(CACHE, exist_ok=True)
OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'js', 'earth-metrics.js')

GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
NDVI = ('MODIS_Terra_L3_NDVI_16Day', '2026-07-28', 9, 'MODIS_L3_NDVI')
IGBP = ('MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', '2024-01-01', 8, 'MODIS_IGBP_Land_Cover_Type')
LST_NIGHT_JAN = ('MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night', '2026-01-01', 6, 'MODIS_Land_Surface_Temp')
LST_DAY_AUG = ('MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day', '2025-08-01', 6, 'MODIS_Land_Surface_Temp')

R_DEM_M = 1000   # terrain window radius
R_COVER_M = 1500  # vegetation window radius

# Candidate sites (docs/data/analogs-earth-hokkaido.md §7). Shikaribetsu coords are approximate.
SITES = [
    ('tokachi',     '十勝岳 62-2火口周辺',        'Mt. Tokachi crater area',      43.418, 142.686),
    ('asahidake',   '大雪山 旭岳',               'Mt. Asahi (Daisetsuzan)',      43.6636, 142.8544),
    ('ohachidaira', '大雪山 御鉢平カルデラ',       'Ohachidaira caldera',          43.678, 142.882),
    ('hakuun',      '大雪山 小泉岳〜白雲岳 高山荒原', 'Koizumi–Hakuun fell-field',    43.651, 142.905),
    ('showashinzan','昭和新山',                  'Showa-shinzan lava dome',      42.5428, 140.8642),
    ('usu',         '有珠山 山頂火口原',           'Mt. Usu summit crater',        42.5436, 140.8389),
    ('tarumae',     '樽前山 溶岩ドーム',          'Mt. Tarumae lava dome',        42.6906, 141.3772),
    ('meakan',      '雌阿寒岳',                  'Mt. Meakan',                   43.3864, 144.0086),
    ('shiretoko',   '知床硫黄山',                'Shiretoko-Iozan',              44.133, 145.161),
    ('atosanupuri', 'アトサヌプリ（硫黄山）',      'Atosanupuri',                  43.61, 144.439),
    ('komagatake',  '北海道駒ヶ岳',              'Hokkaido-Komagatake',          42.063, 140.677),
    ('mashu',       '摩周カルデラ',              'Mashu caldera',                43.572, 144.561),
    ('shikaribetsu','然別 風穴地帯（概略位置）',    'Shikaribetsu wind holes',      43.255, 143.075),
    ('noboribetsu', '登別 地獄谷',               'Noboribetsu Jigokudani',       42.4975, 141.1475),
    ('sapporo',     '札幌市街（対照）',           'Sapporo city (control)',       43.0621, 141.3544),
]

UA = {'User-Agent': 'hokkaido-analog-finder/0.1 (hackathon research)'}


def fetch(url, binary=True, retries=4):
    key = os.path.join(CACHE, urllib.parse.quote(url, safe='')[:200])
    if os.path.exists(key):
        with open(key, 'rb') as f:
            data = f.read()
    else:
        for i in range(retries):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                    data = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if i == retries - 1:
                    raise
                time.sleep(2 * (i + 1))  # GIBS returns transient 403 when hit rapidly
        with open(key, 'wb') as f:
            f.write(data)
    return data if binary else data.decode('utf-8')


# ---------- Web Mercator helpers ----------
def lonlat_to_px(lon, lat, z):
    n = 256 * 2 ** z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def ground_px_m(lat, z):
    return 40075016.686 * math.cos(math.radians(lat)) / (256 * 2 ** z)


def mosaic(lat, lon, radius_m, z, tile_url, decode):
    """Return (array, center_px_in_array, ground_px_m) covering a square window."""
    px_m = ground_px_m(lat, z)
    rpx = int(math.ceil(radius_m / px_m))
    cx, cy = lonlat_to_px(lon, lat, z)
    x0, x1 = int(cx - rpx), int(cx + rpx)
    y0, y1 = int(cy - rpx), int(cy + rpx)
    tx0, tx1, ty0, ty1 = x0 // 256, x1 // 256, y0 // 256, y1 // 256
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    big = None
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            data = fetch(tile_url(z, tx, ty))
            arr = decode(data)
            if big is None:
                big = np.full((H, W) + arr.shape[2:], np.nan if arr.dtype.kind == 'f' else 0, dtype=arr.dtype)
            big[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = arr
    sub = big[y0 - ty0 * 256:y1 - ty0 * 256 + 1, x0 - tx0 * 256:x1 - tx0 * 256 + 1]
    yy, xx = np.mgrid[0:sub.shape[0], 0:sub.shape[1]]
    mask = ((xx - (cx - x0)) ** 2 + (yy - (cy - y0)) ** 2) * px_m ** 2 <= radius_m ** 2
    return sub, mask, (cx - x0, cy - y0), px_m


# ---------- DEM (GSI dem_png) ----------
def decode_gsi(data):
    if data is None:
        return np.full((256, 256), np.nan)
    a = np.asarray(Image.open(io.BytesIO(data)).convert('RGB')).astype(np.int64)
    x = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    invalid = x == 2 ** 23
    x = np.where(x >= 2 ** 23, x - 2 ** 24, x).astype(float) * 0.01
    x[invalid] = np.nan
    return x


def terrain(lat, lon):
    z = 14
    elev, mask, (cx, cy), px_m = mosaic(lat, lon, R_DEM_M, z,
        lambda z, x, y: f'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png', decode_gsi)
    gy, gx = np.gradient(elev, px_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    s = slope[mask & ~np.isnan(slope)]
    e = elev[mask & ~np.isnan(elev)]
    bins = [0, 5, 10, 15, 20, 30, 45, 90]
    hist, _ = np.histogram(s, bins=bins)
    hist = (hist / max(hist.sum(), 1)).round(3).tolist()
    center_elev = float(elev[int(cy), int(cx)]) if not np.isnan(elev[int(cy), int(cx)]) else None
    return {
        'elev_m': round(center_elev, 1) if center_elev is not None else None,
        'slope_mean_deg': round(float(s.mean()), 1),
        'slope_p90_deg': round(float(np.percentile(s, 90)), 1),
        'slope_hist': {'bins': bins, 'frac': hist},
        'relief_m': round(float(e.max() - e.min()), 1),
        'dem': 'GSI dem_png z14',
    }


# ---------- GIBS palette decoding ----------
_cmaps = {}


def colormap(name):
    if name in _cmaps:
        return _cmaps[name]
    root = ET.fromstring(fetch(f'https://gibs.earthdata.nasa.gov/colormaps/v1.3/{name}.xml'))
    table = {}
    for cm in root.findall('ColorMap'):
        legend = {le.get('id'): le.get('tooltip') for le in cm.iter('LegendEntry')}
        for e in cm.iter('ColorMapEntry'):
            rgb = tuple(int(v) for v in e.get('rgb').split(','))
            if e.get('nodata') == 'true' or e.get('transparent') == 'true':
                table[rgb] = None
                continue
            val = e.get('value')
            if val and val.startswith('['):
                a, b = (float(v) for v in val.strip('[]()').split(','))
                table[rgb] = (a + b) / 2
            else:
                table[rgb] = legend.get(e.get('ref'), e.get('label'))
    _cmaps[name] = table
    return table


def gibs_window(layer, lat, lon, radius_m):
    name, date, z, cmap_name = layer
    table = colormap(cmap_name)

    def decode(data):
        if data is None:
            return np.zeros((256, 256, 4), dtype=np.uint8)
        return np.asarray(Image.open(io.BytesIO(data)).convert('RGBA'))

    url = lambda z, x, y: f'{GIBS}/{name}/default/{date}/GoogleMapsCompatible_Level{z}/{z}/{y}/{x}.png'
    rgba, mask, (cx, cy), _ = mosaic(lat, lon, radius_m, z, url, decode)
    vals = []
    for px in rgba[mask]:
        if px[3] == 0:
            continue
        vals.append(table.get(tuple(int(v) for v in px[:3])))
    center = rgba[int(cy), int(cx)]
    cval = table.get(tuple(int(v) for v in center[:3])) if center[3] else None
    return [v for v in vals if v is not None], cval


def cover(lat, lon):
    ndvi, ndvi_c = gibs_window(NDVI, lat, lon, R_COVER_M)
    igbp, igbp_c = gibs_window(IGBP, lat, lon, R_COVER_M)
    return {
        'ndvi_min': round(min(ndvi), 3) if ndvi else None,
        'ndvi_median': round(float(np.median(ndvi)), 3) if ndvi else None,
        'barren_frac': round(sum(1 for v in igbp if v == 'Barren') / len(igbp), 3) if igbp else None,
        'landcover_center': igbp_c,
        'ndvi_date': NDVI[1],
    }


def lst(lat, lon):
    _, night = gibs_window(LST_NIGHT_JAN, lat, lon, 1)
    _, day = gibs_window(LST_DAY_AUG, lat, lon, 1)
    return {'lst_night_jan_K': round(night, 1) if night else None,
            'lst_day_aug_K': round(day, 1) if day else None}


def power(lat, lon):
    url = ('https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR,T2M_MIN,T2M_MAX'
           f'&community=AG&longitude={lon}&latitude={lat}&format=JSON')
    p = json.loads(fetch(url, binary=False))['properties']['parameter']
    return {'precip_mm_yr': round(p['PRECTOTCORR']['ANN'] * 365.25),
            't2m_min_jan_C': p['T2M_MIN']['JAN'], 't2m_max_aug_C': p['T2M_MAX']['AUG']}


def geology(lat, lon):
    url = f'https://gbank.gsj.jp/seamless/v2/api/1.2.1/legend.json?point={lat},{lon}'
    try:
        j = json.loads(fetch(url, binary=False))
    except Exception as e:  # noqa: BLE001
        return {'lithology_ja': None, 'error': str(e)}
    return {'lithology_ja': j.get('lithology_ja'), 'lithology_en': j.get('lithology_en'),
            'age_ja': j.get('formationAge_ja'), 'age_en': j.get('formationAge_en')}


def main():
    out = []
    for sid, ja, en, lat, lon in SITES:
        print(f'… {sid}', file=sys.stderr)
        rec = {'id': sid, 'name': ja, 'en': en, 'lat': lat, 'lon': lon}
        for fn in (terrain, cover, lst, power, geology):
            try:
                rec.update(fn(lat, lon))
            except Exception as e:  # noqa: BLE001
                print(f'   {fn.__name__} failed: {e}', file=sys.stderr)
                rec[f'{fn.__name__}_error'] = str(e)
        out.append(rec)
        print('   ' + json.dumps({k: rec.get(k) for k in ('slope_mean_deg', 'ndvi_min', 'barren_frac',
              'lst_night_jan_K', 'lst_day_aug_K', 'precip_mm_yr', 'lithology_ja')}, ensure_ascii=False),
              file=sys.stderr)
    with open(OUT, 'w') as f:
        f.write('// GENERATED by scripts/compute_earth_metrics.py on '
                f'{time.strftime("%Y-%m-%d %H:%M")} — do not edit by hand.\n')
        f.write('window.EARTH_METRICS = ')
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write(';\n')
    print(f'wrote {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
