# 北海道の月・火星アナログ地点スコアリング用 地球側データ(検証済み)

調査日: 2026-11-14(JST)/ チャレンジ #10 "Earth Analogs"
前提: `docs/data/earthdata.md`(NASA Earthdata 全般の調査)の続き。ここでは **北海道 bbox(lon 139.3–146.0, lat 41.3–45.6)でブラウザ地図から即使えるか** に絞り、全エンドポイントを curl で実際に叩いて確認した。
CORS 列は `Origin: http://localhost:5173` を付けて GET した時の `Access-Control-Allow-Origin` の値。

---

## 0. まとめ表

| データ | 何に使う(スコア次元) | URL template | login | CORS | 検証結果(2026-11-14) |
|---|---|---|---|---|---|
| **AWS Terrain Tiles (terrarium)** | 標高・傾斜・起伏(全球, 〜z15) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | 不要 | `*` | 200 png。十勝岳山頂 z15 で 2049 m(実標高 2077 m) |
| AWS Terrain Tiles (normal / geotiff) | 傾斜をシェーダで / サーバ側解析 | `.../elevation-tiles-prod/normal/{z}/{x}/{y}.png`、`.../geotiff/{z}/{x}/{y}.tif` | 不要 | `*` | どちらも 200 |
| **国土地理院 標高タイル dem_png (10m)** | 標高・傾斜・起伏(日本, 〜z14) | `https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png` | 不要 | `*` | 200。十勝岳 z14 で 2056 m。z15 は 404 |
| 国土地理院 dem5a_png (5m レーザ) | 高精細の起伏・ラフネス | `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png`(z15 のみ) | 不要 | `*` | 200。十勝岳 z15 で 2067 m。**範囲は限定的**(無い所は 404 → dem_png へ fallback) |
| 国土地理院 傾斜量図 / 陰影起伏 / 色別標高 | 見た目のレイヤー(傾斜の可視化) | `.../xyz/slopemap/{z}/{x}/{y}.png`、`.../hillshademap/...png`、`.../relief/...png` | 不要 | `*` | すべて 200 |
| Copernicus DEM GLO-30 (AWS) | 30m DEM(サーバ/前処理用) | `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N43_00_E142_00_DEM/Copernicus_DSM_COG_10_N43_00_E142_00_DEM.tif` | 不要 | **なし**(プリフライト 403) | 200 / 6.4 MB COG / Range 206 OK。**ブラウザから直接は読めない** |
| NASADEM / SRTMGL1 / ASTER GDEM v3 (LP DAAC) | 30m DEM(NASA 由来であることのアピール) | CMR → `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/ASTGTM.003/ASTGTMV003_N43E142_dem.tif` 等 | **必要** | — | 302 → URS ログイン。concept: NASADEM_HGT `C2763264762-LPCLOUD`, ASTGTM `C1711961296-LPCLOUD` |
| GIBS `ASTER_GDEM_Greyscale_Shaded_Relief` / `ASTER_GDEM_Color_Shaded_Relief` / `SRTM_Color_Index` | NASA DEM の見た目レイヤー(値は取れない) | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg`(SRTM は `.png`)※時間なし | 不要 | `*` | 200 |
| **GIBS MODIS LST 月平均(夜/昼)** | 寒冷度(冬夜の地表温度) | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night/default/{YYYY-MM-01}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png` | 不要 | `*` | 200。2026-01 夜: 旭岳 ≈252 K(−21 °C)、札幌 ≈260 K |
| GIBS MODIS LST 8日 | 季節変化 | `.../MODIS_Terra_L3_Land_Surface_Temp_8Day_Day/default/{date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| **GIBS MODIS NDVI 16日** | 植生の無さ(barren 度) | `.../MODIS_Terra_L3_NDVI_16Day/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png` | 不要 | `*` | 200。2026-07-28: 十勝岳 NDVI 0.03 / 周辺の森 0.92 |
| **GIBS MODIS Land Cover (MCD12Q1, IGBP)** | 裸地クラス(IGBP 16 = Barren) | `.../MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual/default/{YYYY}-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`(2001–2024) | 不要 | `*` | 200。**十勝岳 = Barren** を確認 |
| **GIBS MODIS 積雪** | 雪氷の残存(寒冷度) | 日次 `.../MODIS_Terra_NDSI_Snow_Cover/default/{date}/GoogleMapsCompatible_Level8/...png`、月平均 `.../MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct/default/{YYYY-MM-01}/GoogleMapsCompatible_Level6/...png` | 不要 | `*` | 200。2026-05 月平均: 大雪山 100%、十勝岳 93% |
| GIBS カラーマップ XML | PNG の色 → 物理量に戻す | `https://gibs.earthdata.nasa.gov/colormaps/v1.3/{MODIS_Land_Surface_Temp, MODIS_L3_NDVI, MODIS_IGBP_Land_Cover_Type, MODIS_NDSI_Snow_Cover}.xml` | 不要 | `*` | 200(上記の値はこれで復号した) |
| AppEEARS API | 地点/ポリゴンで MOD11A2・MCD12Q1・NASADEM の生値 CSV | `https://appeears.earthdatacloud.nasa.gov/api/product`(一覧は認証なし)、`POST /api/task` | タスク投入は **必要** | — | 一覧 200(193 製品)、未認証 task POST = 403 |
| ESA WorldCover 10m (AWS) | 10m 土地被覆(60 = Bare/sparse, 70 = Snow/ice) | `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42E141_Map.tif`(3°タイル, 左下角名) | 不要 | **なし**(プリフライト 403) | 200 / 3.2 MB。ブラウザ不可 → 事前処理 |
| ESA WorldCover WMS/WMTS (Terrascope) | 上の見た目レイヤー | `https://services.terrascope.be/wms/v2?...LAYERS=WORLDCOVER_2021_MAP` | 不要 | 未確認 | **未検証**(当環境からは HTTP/2 INTERNAL_ERROR / Empty reply) |
| ASTER Global Emissivity AG100 v003 | 岩石の熱赤外放射率(玄武岩・珪長質の区別) | CMR `C2763266348-LPCLOUD` → `.../lp-prod-protected/AG100.003/AG100.v003.44.142.0001/AG100.v003.44.142.0001.h5` | **必要** | — | グラニュール発見 OK、本体は要ログイン(1°タイル HDF5)。GIBS レイヤーなし |
| **Smithsonian GVP 完新世火山 (WFS)** | 火山性・最終噴火年・岩石種 | `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json&bbox=139.3,41.3,146.0,45.6,EPSG:4326` | 不要 | **なし** | 200 / 40 KB GeoJSON / 北海道 20 火山 → **JSON を repo に置いて使う** |
| **気象庁 活火山リスト (JSON)** | 活火山フラグ・日本語名 | `https://www.jma.go.jp/bosai/volcano/const/volcano_list.json` | 不要 | `*` | 200 / 120 火山、北海道 22(code 101–120, 159, 160) |
| **産総研 シームレス地質図 v2 タイル** | 地質(溶岩・火砕岩・第四紀火山岩) | `https://gbank.gsj.jp/seamless/v2/api/1.2.1/tiles/{z}/{y}/{x}.png` ※**{y}/{x} の順** | 不要 | `*` | 200 |
| 産総研 シームレス地質図 凡例 API(地点) | クリック地点の岩相・時代 | `https://gbank.gsj.jp/seamless/v2/api/1.2.1/legend.json?point={lat},{lon}` | 不要 | `*` | 200。十勝岳 →「後期更新世 安山岩・玄武岩質安山岩 溶岩・火砕岩」 |
| **EOX Sentinel-2 cloudless** | ベースマップ | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg`(`s2cloudless_3857`=2016, `-2023_3857`, `-2025_3857` も 200) | 不要 | Origin を反射 | 200 |
| 国土地理院 シームレス空中写真 | 高解像ベースマップ(国内) | `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg` | 不要 | `*` | 200 |

**ブラウザで直接読める(CORS OK)のは:** AWS Terrain Tiles、GSI 全タイル、GIBS(タイル・WMS・カラーマップ)、GSJ 地質図(タイル+凡例 API)、JMA JSON、EOX。
**事前処理が必要(CORS なし or ログイン必須)なのは:** Copernicus DEM、ESA WorldCover COG、GVP WFS、NASADEM/ASTER GDEM/AG100(LP DAAC)、AppEEARS。

---

## 1. 標高・傾斜・ラフネス

### 1.1 推奨: ブラウザでタイルを読んでクライアントで傾斜/ラフネスを計算
- **国内は GSI `dem_png`(z14, 約 10m)**、高精細が欲しい所は `dem5a_png`(z15, 5m、範囲限定)、無い所は AWS terrarium にフォールバック。
- デコード式:
  - terrarium: `elev = R*256 + G + B/256 - 32768`(m)
  - GSI dem_png: `x = R*65536 + G*256 + B; if x >= 2^23: x -= 2^24; elev = x*0.01`(m)。`x == 2^23`(RGB = 128,0,0)は **無効値**(海など)。
- 傾斜: 隣接ピクセル差分。ピクセル幅 = `40075016.686 * cos(lat) / 2^z / 256`(z14・北緯43°で約 7 m)。
- ラフネス: 3×3 または 5×5 窓の標高標準偏差 or TRI(Terrain Ruggedness Index)。月面の「平坦な着陸適地」なら低傾斜・低ラフネス、溶岩洞/崖なら高ラフネス。
- MapLibre なら terrarium は `raster-dem` ソース(`encoding: "terrarium"`)でそのまま 3D・hillshade に使える。GSI dem_png は MapLibre のカスタムプロトコル(`addProtocol`)で変換するか、terrarium を使う。

検証(十勝岳山頂 43.4181, 142.6864 / 実標高 2077 m・ピクセル中心がずれるので数十 m の差は正常):

| ソース | z | タイル | 値 |
|---|---|---|---|
| AWS terrarium | 12 | 12/3671/1498 | 2038 m |
| AWS terrarium | 15 | 15/29371/11988 | 2049 m |
| GSI dem_png | 14 | 14/14685/5994 | 2056 m |
| GSI dem5a_png | 15 | 15/29371/11988 | 2067 m |

```bash
curl -o t.png https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/29371/11988.png
curl -o g.png https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/14685/5994.png
```

### 1.2 NASA DEM(NASADEM / SRTM / ASTER GDEM v3)
- いずれも LP DAAC、1°タイル(北海道は N41–N45 × E139–E145 の約 30 枚)、**Earthdata Login 必須**(未認証は 302 → urs.earthdata.nasa.gov)。
- 検索(ログイン不要): `https://cmr.earthdata.nasa.gov/search/granules.json?collection_concept_id=C1711961296-LPCLOUD&point=142.686,43.418`
  - NASADEM: `NASADEM_HGT_n43e142.zip`(.hgt in zip)/ ASTER: `ASTGTMV003_N43E142_dem.tif`(GeoTIFF)/ SRTMGL1 `C2763266360-LPCLOUD`
- AppEEARS でも `NASADEM_NC.001`, `ASTGTM_NC.003`, `SRTMGL1_NC.003`(30m)が切り出せる。
- **見た目だけなら GIBS の `ASTER_GDEM_Greyscale_Shaded_Relief` / `ASTER_GDEM_Color_Shaded_Relief` / `SRTM_Color_Index`(z12 まで, 時間次元なし)**がログイン不要。発表で「NASA ASTER GDEM を使用」と言える。
- 実運用の標高値は GSI/terrarium で十分(terrarium の中身自体が SRTM/NASADEM 系+各国 DEM の合成)。

### 1.3 Copernicus DEM GLO-30
- `s3://copernicus-dem-30m/Copernicus_DSM_COG_10_N{lat}_00_E{lon}_00_DEM/...tif`(1°、COG、約 6.4 MB/枚)。ログイン不要。
- **CORS ヘッダなし → ブラウザの geotiff.js で直接読めない**。Python(rasterio `/vsicurl/`)で北海道分(〜30 枚 ≈ 200 MB)を処理し、傾斜/ラフネスをタイル or 小さい GeoJSON/グリッドにして配信する用途向け。リポジトリ外(`~/cache`)に置くこと。
- OpenTopography の globaldem API(COP30/NASADEM 切り出し)は **API キー必須**(キーなしで "API Key required")。

---

## 2. 地表面温度(寒冷度)

### 2.1 GIBS(ログイン不要・推奨)
GetCapabilities(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities`、5.8 MB)で確認したレイヤー:

| Layer ID | TileMatrixSet(最大 z) | 時間範囲 / 既定 | 用途 |
|---|---|---|---|
| `MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night` | GoogleMapsCompatible_Level6 | 2000-03-01/2026-10-01/P1M | **冬夜の寒さ(主指標)** |
| `MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day` | Level6 | 同上 | 夏昼の温度(低い=寒冷) |
| `MODIS_Terra_L3_Land_Surface_Temp_8Day_Day` / `_Night` | Level7 | P8D, 既定 2026-11-01 | |
| `MODIS_Terra_Land_Surface_Temp_Day` / `_Night` | Level7 | 日次(雲で欠損多い) | |
| `MODIS_Aqua_*` 同名 | | | Aqua 版 |
| `VIIRS_SNPP_L3_Land_Surface_Temp_Monthly_Night` 等 | Level7 | 2012-02〜 | VIIRS 版(Level7 で少し細かい) |

URL 例(2026-01 夜, 北海道中央を含む z6 タイル):
```
https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night/default/2026-01-01/GoogleMapsCompatible_Level6/6/23/57.png
```
- **WMTS の並びは `{z}/{y}/{x}`(TileRow/TileCol)**。Leaflet/MapLibre の `{z}/{y}/{x}` でそのまま書ける。
- EPSG:4326 版は `.../wmts/epsg4326/best/{Layer}/default/{date}/{TMS}/{z}/{row}/{col}.png` で TMS 名が `1km`/`2km`/`250m` 等(レイヤー毎に違う。誤ると 400)。地図ライブラリと合わせるなら **3857 を使う**。
- 北海道全域を 1 枚で: WMS
  `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night&STYLES=&CRS=EPSG:4326&BBOX=41.3,139.3,45.6,146.0&WIDTH=670&HEIGHT=430&FORMAT=image/png&TIME=2026-01-01` → 200 / 10 KB / CORS `*`。**スコア計算用のラスタとしてこれ 1 枚を canvas で読むのが最速。**
- **値への復号**: PNG はパレット画像。カラーマップ `https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Land_Surface_Temp.xml` の `ColorMapEntry rgb=... value="[a,b)"`(単位 K, 0.6 K 刻み, 200–… K)で RGB → 温度区間。

### 2.2 生値が要る場合: AppEEARS(要ログイン)
- 製品 `MOD11A2.061`(1km, 8日)/`MOD11A1.061`(日次)、レイヤー `LST_Day_1km`, `LST_Night_1km`(×0.02 K)。
- 地点リスト(候補地 10–20 点)で point リクエストを投げると CSV。非同期なので **朝イチで投げる**。concept MOD11A2: `C2269056084-LPCLOUD`。

---

## 3. 植生の無さ(barren)

### 3.1 MODIS NDVI(GIBS)
- `MODIS_Terra_L3_NDVI_16Day`(GoogleMapsCompatible_Level9 ≈ 北緯43°で 220 m/px、2000-03-05〜既定 2026-10-16, P16D)
- `MODIS_Terra_L3_NDVI_Monthly`(Level7)、`VIIRS_SNPP_L3_NDVI_16Day` 等も有り。
- カラーマップ: `colormaps/v1.3/MODIS_L3_NDVI.xml`(0.005 刻み区間)。
- **夏(7月下旬〜8月)の画像を使う**(雪の季節は NDVI が低く出て裸地と区別できない)。検証: 2026-07-28 で十勝岳火口 0.025–0.030、山麓の森 0.92。

### 3.2 MODIS Land Cover MCD12Q1(GIBS)
- `MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual`(Level8, 2001–2024 年次, 500m)。
- カラーマップ `MODIS_IGBP_Land_Cover_Type.xml`: **Barren = rgb(191,191,189) = クラス16**、Permanent Snow and Ice = (255,255,255) = 15、Urban = (255,0,0) = 13。
- 北海道で Barren になるのは十勝岳など極めて限られる(500m 画素のため)。**NDVI と組み合わせた連続値スコア**にすべき。
- 生 HDF は `MCD12Q1.061`(`C2484079608-LPCLOUD`、要ログイン)/AppEEARS。

### 3.3 ESA WorldCover 10m(AWS, ログイン不要)
- `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{N42E141}_Map.tif`(3°×3° タイル、北海道は N39/N42/N45 × E138/E141/E144 の組合せ)。v100/2020 もある。
- クラス: 60 = Bare/sparse vegetation、70 = Snow and ice、10 = Tree cover、50 = Built-up。
- **CORS なし** → Python で北海道を切り出して「60 の割合」を 500m グリッドにして JSON 化、が現実的。Terrascope の WMS/WMTS は今回の環境から接続できず未検証。

---

## 4. 雪氷

| Layer ID | TMS | 時間 | メモ |
|---|---|---|---|
| `MODIS_Terra_NDSI_Snow_Cover` | Level8 | 日次(2000-02-24〜当日) | 雲で欠損。カラーマップ `MODIS_NDSI_Snow_Cover.xml` |
| `MODIS_Terra_L3_NDSI_Snow_Cover_Daily` | — | 日次 L3 | |
| `MODIS_Terra_L3_Snow_Extent_8Day` | — | 8日 | |
| **`MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct`** | Level6 | 月(〜2026-10-01) | **5–6月の残雪率 = 寒冷度の良い指標** |
| `VIIRS_SNPP_NDSI_Snow_Cover`, `VIIRS_NOAA20_NDSI_Snow_Cover` | | 日次 | MODIS 後継 |

検証 (2026-05 月平均): 旭岳・御鉢平・小泉岳 100%、知床硫黄山 100%、十勝岳 93%、樽前・有珠・雌阿寒 0%。
生データは `MOD10A1` v61(`C2565093311-NSIDC_CPRD`、要ログイン)。

---

## 5. 地質・火山

### 5.1 Smithsonian GVP(Volcanoes of the World)
- WFS(上表 URL)で北海道 bbox を GeoJSON 取得 → **20 火山**、40 KB。属性: `Volcano_Number, Volcano_Name, Primary_Volcano_Type, Last_Eruption_Year, Latitude, Longitude, Elevation, Major_Rock_Type, Geological_Summary, Tectonic_Setting`。
- CORS なし → **一度 curl して `data/gvp_hokkaido.geojson` としてリポジトリに置く**(小さいので OK)。
- 注意: GVP は複合火山をまとめる。**有珠山・昭和新山は "Toya"(285030)**、**樽前山・恵庭岳は "Shikotsu"(285040)**、**雌阿寒岳・雄阿寒岳は "Akan"(285070)** に含まれる。
- 玄武岩系(`Basalt / Picro-Basalt`)は Oshima-Oshima、Kuttara、Toya の 3 件、その他は安山岩/玄武岩質安山岩、Kussharo はデイサイト。

### 5.2 気象庁 活火山リスト
- `https://www.jma.go.jp/bosai/volcano/const/volcano_list.json`(CORS `*`、要素: `code, latlon, name_jp, name_en`。一部要素は `latlon` を持たないので注意)。
- 北海道の 22 活火山: 101 知床硫黄山, 102 羅臼岳, 103 摩周, 104 アトサヌプリ, 105 雌阿寒岳, 106 丸山, 107 大雪山, 108 十勝岳, 109 樽前山, 110 恵庭岳, 111 倶多楽, 112 有珠山, 113 北海道駒ヶ岳, 114 恵山, 115 渡島大島, 116 利尻山, 117 羊蹄山, 118 ニセコ, 119 天頂山, 120 雄阿寒岳, 159 羅臼山, 160 泊山(後 2 つは北方領土)。

### 5.3 産総研 シームレス地質図 v2
- タイル: `https://gbank.gsj.jp/seamless/v2/api/1.2.1/tiles/{z}/{y}/{x}.png`(**GSI と逆で y が先**)。CORS `*`。
- 地点凡例: `.../legend.json?point={lat},{lon}` → `title, symbol, lithology_ja/en, formationAge_ja/en, group_ja/en`。クリック時の詳細表示や、候補地の「溶岩・火砕岩」「完新世」判定に使える。
- 凡例全体: `.../legend.json`(1.5 MB)。「溶岩」「玄武岩」「完新世」を含む凡例の RGB を集めてタイルを色マスクすれば **溶岩/火山岩マスク** をブラウザで作れる。

### 5.4 ASTER 放射率 AG100 / 熱赤外
- `AG100` v003(100m, 1°タイル HDF5, `C2763266348-LPCLOUD`)— 5 バンド(10–12 μm)平均放射率。玄武岩(苦鉄質)は 8–9 μm 帯で放射率が高め、珪長質は低め → 火星の玄武岩質地殻アナログ指標になりうる。**要ログイン・GIBS なし・AppEEARS なし** → 時間があれば Python で北海道 30 タイルを処理。プレビュー JPG は `lp-prod-public/.../*.h5.2.jpg`(署名付き CloudFront へ 303)。
- 優先度低。GSJ 地質図の岩相で代用するのが現実的。
- 活動的熱異常は GIBS `MODIS_Combined_Thermal_Anomalies_All` / `VIIRS_NOAA20_Thermal_Anomalies_375m_All`(epsg4326 で確認、ベクトル系)。

---

## 6. ベースマップ

- **EOX Sentinel-2 cloudless**: `https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg`
  - layer: `s2cloudless_3857`(2016, **CC BY 4.0**)、`s2cloudless-2023_3857`、`s2cloudless-2024_3857`、`s2cloudless-2025_3857`(2018 年版以降は **CC BY-NC-SA 4.0**、非商用・帰属表示 "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)")。ハッカソンは非商用なので OK。
  - CORS は Origin を反射(実質 OK)。
- 国内なら GSI `seamlessphoto`(写真)・`std`(標準地図)も CORS `*`。帰属「出典: 国土地理院」。

---

## 7. 候補アナログ地点(座標+実測スコア素材)

値は上の API から 2026-11-14 に取得(`sites.py` 相当の処理: GSI dem z14、GIBS タイルの色をカラーマップで復号、GSJ 凡例 API)。LST は Level6(約 1.8 km/px)なのでピーク部は周辺と平均化されている点に注意。

| # | 地点 | lat, lon | 標高 m / 傾斜° | IGBP 2024 | NDVI 2026-07-28 | LST 夜 2026-01 (K) | 残雪 2026-05 | 地質(GSJ) | アナログの理由 | 出典 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 十勝岳(62-2 火口周辺) | 43.418, 142.686 | 2062 / 29 | **Barren** | **0.03** | 255.5 | 93% | 後期更新世 安山岩・玄武岩質安山岩 溶岩・火砕岩 | 植生ゼロの火砕物斜面・噴気。月/火星の荒涼地表 | GVP 285050, JMA 108 |
| 2 | 大雪山 旭岳 | 43.6636, 142.8544 | 2287 / 14 | Grasslands | 0.41 | **251.9(最寒)** | 100% | 同上 | 道内最高峰・最寒、噴気地 | GVP 285060, JMA 107 |
| 3 | 大雪山 御鉢平カルデラ | 43.678, 142.882 | 1915 / 4 | Grasslands | 0.87 | 252.5 | 100% | 完新世 谷底堆積物 | 直径約 2 km のカルデラ = クレーター地形アナログ | GVP 285060 |
| 4 | 大雪山 小泉岳〜白雲岳(高山荒原・構造土) | 43.651, 142.905 | 1856 / 8 | Grasslands | 0.82* | 254.9 | 100% | カラブリアン期 安山岩溶岩 | **山岳永久凍土・構造土(パターンドグラウンド)= 火星周氷河地形** | 北大 石川ほか(下記)、KAKEN 21710028 |
| 5 | 昭和新山 | 42.5428, 140.8642 | 390 / 28 | Grasslands | 0.78* | 259.7 | 0% | 完新世 デイサイト溶岩 | 1943–45 年生成の溶岩ドーム、裸岩 | GVP 285030 (Toya), JMA 112 |
| 6 | 有珠山 山頂火口原 | 42.5436, 140.8389 | 719 / 10 | Grasslands | 0.82* | 259.7 | 0% | 完新世 デイサイト溶岩・火砕岩 | 2000 年噴火の火口群(西山火口)、潜在ドーム | GVP 285030, JMA 112 |
| 7 | 樽前山 溶岩ドーム | 42.6906, 141.3772 | 1030 / 19 | Savannas | **0.36** | 262.1 | 0% | 完新世 安山岩 溶岩・火砕岩 | 1909 年溶岩ドーム、軽石の荒原 | GVP 285040 (Shikotsu), JMA 109 |
| 8 | 雌阿寒岳 | 43.3864, 144.0086 | 1496 / 6 | Grasslands | **0.10** | 260.3 | 0% | 完新世 安山岩 溶岩・火砕岩 | 植生の無い火口原・噴気、成層火山 | GVP 285070 (Akan), JMA 105 |
| 9 | 知床硫黄山 | 44.133, 145.161 | 1539 / 59 | Savannas | 0.79* | 259.7 | 100% | 完新世 安山岩 | 1936 年の溶融硫黄噴出 = 硫黄に富む火星/イオ地表アナログ | GVP 285090, JMA 101 |
| 10 | アトサヌプリ(硫黄山) | 43.61, 144.439 | 495 / 43 | Grasslands | 0.56 | 261.5 | 0% | 完新世 デイサイト溶岩 | 硫黄噴気・酸性変質の裸地(火星の硫酸塩/熱水変質アナログ)、屈斜路カルデラ内 | JMA 104, GVP 285080 (Kussharo) |
| 11 | 北海道駒ヶ岳 | 42.063, 140.677 | 1095 / 43 | Grasslands | 0.43 | 266.3 | 0% | 完新世 デイサイト溶岩・火砕岩 | 1929 年大噴火の軽石原、裸地の広い山頂部 | GVP 285020, JMA 113 |
| 12 | 摩周カルデラ | 43.572, 144.561 | 805 / 74(壁) | Decid. Forest | 0.87 | 259.1 | 0% | 完新世 デイサイト | 急崖に囲まれたカルデラ湖 = 衝突クレーター形状アナログ | GVP 285081, JMA 103 |
| 13 | 然別湖周辺の風穴群(とかち鹿追ジオパーク) | 43.255, 143.075(概略位置) | 1026 / 35 | Mixed Forest | 0.87 | 258.5 | 0% | 後期更新世 安山岩溶岩 | **低標高の永久凍土**(崖錐の風穴で維持、約 4000 年前の氷)= 火星の地下氷アナログ | 国交省 観光庁多言語解説 R4-00357 |
| 参考 | 札幌市街(対照) | 43.0621, 141.3544 | 21 / 0 | Urban | 0.29 | 259.7 | 0% | 扇状地堆積物 | NDVI が低くても都市 → IGBP で除外が必要 | — |

\* 点座標が火口内の裸地から外れて植生ピクセルに当たっているもの。NDVI/LST は 200 m–2 km 画素なので、**点ではなく半径 1–2 km の最小 NDVI / 最大 barren 割合で評価する**のが良い。
※ 恵山(41.805, 141.166, 溶岩ドーム, NDVI 0.24)も裸地候補。

### スコア設計のヒント
- 月アナログ: 低 NDVI + 火山岩/火砕岩(GSJ)+ 低ラフネス〜クレーター状地形(カルデラ)+ 寒冷。
- 火星アナログ: 低 NDVI + 玄武岩系(GVP `Major_Rock_Type`)+ 周氷河(残雪率・冬夜 LST・永久凍土文献)+ 硫黄/熱水変質(知床硫黄山・アトサヌプリ)。
- 「永久基地候補地」寄り: 低傾斜(<10°)+ 寒冷 + 裸地 → 大雪山の高山荒原、雌阿寒岳火口原など。

---

## 8. ハマりどころ

1. **タイル座標の順序がサービスでバラバラ**: GSI / AWS terrarium は `{z}/{x}/{y}`、**GIBS WMTS と GSJ 地質図と EOX は `{z}/{y}/{x}`**。
2. **GIBS の最大ズームはレイヤー毎**(LST 月平均 = Level6, NDVI 16日 = Level9, IGBP = Level8, ASTER GDEM = Level12)。超えると 400/404。MapLibre では `maxzoom` をレイヤー毎に設定し、それ以上はオーバーズーム。
3. **GIBS の日付**: 月次は `YYYY-MM-01`、8 日/16 日は合成期間の開始日(例 NDVI 16Day は 2026-07-28 は可)。範囲外日付は空タイル/エラー。静的(DEM)レイヤーは日付部分を省略。
4. **GIBS を連続で叩くと一時的に 403(text/html 919 B)**が返った。数秒空けると 200。ブラウザで大量タイルを読む分には問題ないが、スクリプトは sleep+リトライ。
5. **GIBS PNG は「色」であって生値ではない**: パレット PNG → カラーマップ XML で区間値に戻す。透明=欠損(雲・水域)。canvas で読むには `img.crossOrigin = "anonymous"`(GIBS は CORS `*` なので OK)。
6. **CORS なしのソース**(Copernicus DEM, WorldCover COG, GVP WFS): ブラウザから fetch 不可。事前に Python で処理して小さい JSON/PNG にしてリポジトリへ(GVP は 40 KB なのでそのまま置ける)。**大きい COG はリポジトリに入れない**。
7. **GSI dem5a は範囲が限定的**、dem_png は z14 まで(z15 は 404)。無効値 RGB(128,0,0)。
8. **冬の NDVI は使わない**(雪で全域低 NDVI)。裸地判定は夏の 16 日合成+IGBP 都市マスク。
9. **GVP の火山名と一般名のズレ**(Usu/Showa-shinzan → Toya、Tarumae → Shikotsu、Meakan → Akan)。表示名は JMA リストの `name_jp` を使うと日本語で自然。
10. **ライセンス・帰属**: GSI「出典: 国土地理院」、GSJ「産総研地質調査総合センター シームレス地質図 V2」、EOX(2018 年版以降 CC BY-NC-SA)、GIBS「NASA EOSDIS GIBS」、Mapzen terrain tiles(各 DEM の帰属, AWS Open Data)、ESA WorldCover(CC BY 4.0)。
11. Terrascope(WorldCover WMS/WMTS)は今回の環境では接続エラー(HTTP/2 INTERNAL_ERROR)。会場ネットワークで再確認するか、使わない前提で設計。

---

## 9. 参考・出典
- 大雪山の永久凍土: 北大 石川守ほか [HUSCAP PDF](https://eprints.lib.hokudai.ac.jp/repo/huscap/all/44276/6_ishikawa.pdf)、[KAKEN 21710028 成果報告](https://kaken.nii.ac.jp/file/KAKENHI-PROJECT-21710028/21710028seika.pdf)(標高 2000 m 付近で凍土厚 40–50 m 推定)、[北大プレスリリース 2021-08-02](https://www.hokudai.ac.jp/news/pdf/210802_pr2.pdf)(将来の凍土環境縮小予測)、[低温科学 34 p257](https://eprints.lib.hokudai.ac.jp/repo/huscap/all/18322/34_p257-260.pdf)
- 然別の風穴と永久凍土: [観光庁 多言語解説 "Windholes and Permafrost"](https://www.mlit.go.jp/tagengo-db/en/R4-00357.html)、["Shaped by the Cold"](https://www.mlit.go.jp/tagengo-db/en/R4-00338.html)
- 火山座標: Smithsonian GVP WFS(上記)、気象庁 `volcano_list.json`
- GIBS: GetCapabilities(epsg3857/epsg4326 best)、カラーマップ v1.3
