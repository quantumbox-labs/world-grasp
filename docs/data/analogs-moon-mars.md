# 月・火星側リファレンスデータ（Earth Analogs チャレンジ用）

検証日: 2026-11-14 (JST) / 全て curl またはブラウザで実リクエストして確認済み。
「CORS」はリクエストに `Origin: http://localhost` を付けたとき `Access-Control-Allow-Origin: *` が返ったかどうか。

## 0. 最重要まとめ（ブラウザ地図にそのまま使えるもの）

| データ | 用途 | URL template | login | CORS | 検証結果 |
|---|---|---|---|---|---|
| LRO LROC WAC モザイク v2（月の可視画像） | 月ベースマップ | `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg` | 不要 | `*` | 200 image/jpeg |
| LOLA カラー陰影（128ppd v04） | 月地形の見た目 | `https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrShade_Global_128ppd_v04/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 png |
| LOLA 陰影（256ppd v06） | 月 hillshade | `.../Moon/EQ/LRO_LOLA_Shade_Global_256ppd_v06/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 png |
| LOLA 傾斜（カラー、16ppd） | 月の傾斜 (slope) | `.../Moon/EQ/LRO_LOLA_ClrSlope_Global_16ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 png |
| LOLA 粗さ（カラー、16ppd） | 月の粗さ (roughness) | `.../Moon/EQ/LRO_LOLA_ClrRoughness_Global_16ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 png |
| LOLA+かぐや TC 傾斜（512ppd, 60S–60N） | 高解像度の傾斜（JAXA 連携） | `.../Moon/EQ/LRO_LOLAKaguya_ClrSlope_60N60S_512ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 png |
| LOLA 永久影 (PSR) 南極 65S 以南 240m | 南極の照明・PSR | `.../Moon/EQ/LRO_LOLA_Illumination_SPole65S_240m_EQ/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200（z3/7/8 で確認） |
| LOLA 南極カラー陰影（75S 以南、30m） | 南極の詳細地形 | `.../Moon/EQ/LRO_LOLA_ClrShade_SPole75_30mp_v04_EQ/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200（z3/7/8） |
| LROC NAC PSR モザイク 南極 20m | PSR 内部の画像 | `.../Moon/EQ/NAC_POLE_PSR_SOUTH_STRETCH_EQ/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| Diviner 平均表面温度（カラー、32ppd） | 月の温度 | `.../Moon/EQ/LRO_Diviner_ST_Avg_Clr_Global_32ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| Diviner 最高・最低温度（カラー） | 温度レンジ | `.../Moon/EQ/diviner_Clrtbol_max/...{z}/{y}/{x}.png` と `diviner_Clrtbol_min` | 不要 | `*` | 200 |
| Diviner 岩石存在度 | 岩石の多さ (rockiness) | `.../Moon/EQ/Diviner_avg_RockAbundance/...{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| かぐや TC オルソモザイク | JAXA 画像のベースマップ | `.../Moon/EQ/Kaguya_TCortho_Mosaic_Global_4096ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| **Artemis III 候補 13 地域（GeoJSON）** | 月基地候補のポリゴン | `https://trek.nasa.gov/moon/trekarcgis2/rest/services/A3_Named_regions/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson` | 不要 | `*` | 200 application/geo+json、4.4KB、13 features |
| **月の標高（1 点）API** | 地点の LOLA 標高 | `https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer/identify?geometry={"x":LON,"y":LAT}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json` | 不要 | `*` | 200（`value` は 1737.4 km 球に対する標高 m） |
| **月の温度（1 点）API** | 地点の Diviner Tmax/Tmin | `https://trek.nasa.gov/moon/trekarcgis2/rest/services/diviner_tbol_max/ImageServer/identify?...`（Tmin は `diviner_tbol_min`） | 不要 | `*` | 200（値の単位は K、0.5ppd ≒ 60 km 格子と粗い） |
| Viking MDIM2.1 カラーモザイク | 火星ベースマップ | `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg` | 不要 | `*` | 200 jpeg |
| MOLA カラー陰影 | 火星地形 | `.../Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg` | 不要 | `*` | 200 jpeg |
| MOLA+HRSC カラー陰影 / 陰影（200m, ESA 連携） | 火星地形（高解像度） | `.../Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/...{z}/{y}/{x}.png`（.jpg も可）、`..._Shade_...` | 不要 | `*` | 200 |
| MOLA 表面粗さ | 火星の粗さ | `.../Mars/EQ/mola_roughness/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| THEMIS 昼間赤外 100m | 火星の熱画像（岩盤か砂か） | `.../Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| TES 熱慣性 | 火星の熱慣性 | `.../Mars/EQ/TES_Thermal_Inertia/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 不要 | `*` | 200 |
| TES 高 Ca 輝石量 | 玄武岩組成の代わり | `.../Mars/EQ/TES_Clinopyroxene/...{z}/{y}/{x}.png`（他に `TES_Dust`, `TES_Glass_Clay`, `Mars_MGS_TES_Albedo_mosaic_global_7410m`） | 不要 | `*` | 200 |
| CTX 全球モザイク（Caltech beta01, 5m） | 火星の高解像度画像 | `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}`（**512px タイル**） | 不要 | `*` | 200 png（z0 と z8 で確認） |
| HiRISE 全球（未制御） | 火星の超高解像度（範囲は部分的） | `https://astro.arcgis.com/arcgis/rest/services/OnMars/HiRISE/MapServer/tile/{z}/{y}/{x}`（512px） | 不要 | `*` | 200 |
| **火星の標高（1 点）API** | 地点の MOLA 標高 | `https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer/identify?geometry={"x":LON,"y":LAT}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json` | 不要 | Origin をそのまま返す（localhost で可） | 200 |

`...` は `https://trek.nasa.gov/tiles` を省略したもの。

### タイル利用時の注意（重要）
- Trek の EQ タイルは **Web メルカトルではなく、正距円筒図法（Equirectangular, 経緯度）**。z=0 は 2×1 枚（左が西半球）、256px。`{z}/{y}/{x}` は WMTS の `{TileMatrix}/{TileRow}/{TileCol}`。
  - Leaflet: `L.map(id,{crs:L.CRS.EPSG4326})` + `L.tileLayer(url,{tileSize:256, noWrap:true})` で一致する（Leaflet の EPSG4326 も z0=2×1）。
  - OpenLayers: `EPSG:4326` の WMTS（GetCapabilities を読む）。
- 拡張子は層ごとに `.jpg` か `.png` に固定されている（WAC, Viking, MOLA ClrShade は jpg、それ以外はほとんど png。違う方を使うと 404）。正しいのは `https://trek.nasa.gov/tiles/<Body>/EQ/<Layer>/1.0.0/WMTSCapabilities.xml` で確認できる（CORS `*`）。
- CTX/HiRISE（astro.arcgis.com）は 512px タイル。Leaflet EPSG4326 では `tileSize:512, zoomOffset:-1`。
- 南極付近は正距円筒だと大きく歪む。Trek には極ステレオのタイルもある（例: `https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_Illumination_SPole65S_240m/1.0.0/default/default028mm/0/0/0.png` → 200。CRS はメートル単位の極ステレオ）が、proj4leaflet が必要なので、ハッカソンでは EQ のタイル + 南極周辺の小地図で十分と判断。
- 地物の検索 API（レイヤー名と地名座標の取得）: `https://trek.nasa.gov/{moon|mars}/TrekServices/ws/index/eq/searchItems?start=0&rows=50&key=<語>&fq=itemType:product`（`itemType:nomenclature` にすると IAU 地名と座標）。レイヤーのサービス一覧: `.../ws/index/getLayerServices?uuid=<item_UUID>`。
- Trek の設定 JSON（全サービス URL）: `https://trek.nasa.gov/moon/jpl/config/config.json`

USGS Astrogeology の WMS も応答した（`https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/moon/moon_simp_cyl.map&service=WMS&request=GetCapabilities` → 200）。予備として使える。

---

## 1. 月の基地候補地

### 1a. Artemis III 候補 13 地域（2022-08-19 発表）
出典: NASA Moon Trek の `A3_Named_regions` レイヤー（上の GeoJSON）。中心座標は、ポリゴンの頂点を南極ステレオ投影に変換して平均したもの（この作業で計算）。標高と Tmax/Tmin はこの作業で ImageServer から取った値（LOLA 256ppd、Diviner tbol 0.5ppd）。**Diviner は約 60 km 格子なので、地域の代表値としてだけ使うこと**（個々の着陸地点の値ではない）。

| 地域 | 緯度 | 経度 | 標高 m | Tmax K | Tmin K | 2024 の 9 地域に残ったか |
|---|---|---|---|---|---|---|
| Faustini Rim A | -87.89 | 90.00 | 48 | 232 | 49 | 外れた |
| Peak Near Shackleton（GeoJSON の表記は "Shakleton"） | -88.81 | 123.69 | 1647 | 236 | 67 | 外れた |
| Connecting Ridge | -89.46 | -137.49 | 1948 | 257 | 88 | 外れた |
| Connecting Ridge Extension | -89.03 | -102.00 | 1181 | 231 | 57 | 外れた |
| de Gerlache Rim 1 ("de Gerlache Rim") | -88.68 | -67.93 | 1799 | 209 | 65 | 外れた |
| de Gerlache Rim 2 | -88.23 | -64.63 | -96 | 241 | 64 | 残った |
| de Gerlache-Kocher Massif | -85.83 | -116.32 | 2704 | 257 | 61 | 外れた |
| Haworth | -86.76 | -22.78 | 1634 | 207 | 51 | 残った |
| Malapert Massif | -85.99 | -0.24 | 4792 | 296 | 75 | 残った |
| Leibnitz Beta Plateau（現在は Mons Mouton Plateau） | -85.43 | 31.74 | 6376 | 252 | 76 | 残った（名前が変わった） |
| Nobile Rim 1 | -85.44 | 37.37 | 5951 | 215 | 66 | 残った |
| Nobile Rim 2 | -83.95 | 58.82 | 1008 | 233 | 62 | 残った |
| Amundsen Rim | -84.23 | 69.44 | 403 | 256 | 63 | 外れた |

### 1b. 2024-10-28 発表の 9 地域
Peak near Cabeus B、Haworth、Malapert Massif、Mons Mouton Plateau、Mons Mouton、Nobile Rim 1、Nobile Rim 2、de Gerlache Rim 2、Slater Plain。
出典: [UPI](https://www.upi.com/Science_News/2024/10/28/nasa-artemis-moon-landing-regions/5971730152372/)、[Space.com](https://www.space.com/space-exploration/artemis/nasa-announces-9-possible-moon-landing-sites-for-artemis-3-lunar-mission)。NASA の元記事は URL 変更で 404 だった（`nasa.gov/missions/artemis/nasa-provides-update-on-artemis-iii-moon-landing-regions/`）。
2022 の GeoJSON にない新しい地域の座標（IAU 地名から。**地域ポリゴンではなく近似値**）:

| 地域 | 緯度 | 経度 | 根拠 |
|---|---|---|---|
| Mons Mouton | -84.81 | 38.15 | Trek の地名データ。LOLA 標高 6810 m、Tmax 232 K、Tmin 67 K |
| Peak near Cabeus B | 約 -82 〜 -84 | 約 -50 | Cabeus（-85.28, -41.81、Trek の地名データ）の近く。要確認 |
| Slater Plain | 約 -88 | 約 110 | Slater クレーター付近（Shackleton と de Gerlache の近く）。要確認 |

### 1c. 南極のそのほかの基準点（Trek の地名データ、この作業で測った値）
| 地点 | 緯度 | 経度 | 標高 m | Tmax K | Tmin K | メモ |
|---|---|---|---|---|---|---|
| Shackleton（クレーターの中心） | -89.63 | 132.32 | -2670 | 91 | 42 | 床は PSR。直径 約 21 km |
| Haworth（クレーター） | -87.20 | -7.49 | | | | PSR |
| Shoemaker | -88.03 | 39.85 | | | | PSR |
| Faustini | -87.18 | 85.02 | | | | PSR |
| de Gerlache | -88.45 | -90.45 | | | | |
| Cabeus | -85.28 | -41.81 | | | | LCROSS 衝突地点（2009, 水を検出） |
| Amundsen | -84.44 | 83.07 | | | | |
| Malapert | -84.80 | 12.31 | | | | |

### 1d. 溶岩チューブと低緯度の参照点（北海道の玄武岩・溶岩地形の比較相手）
| 地点 | 緯度 | 経度 | 標高 m | Tmax K | Tmin K | メモ |
|---|---|---|---|---|---|---|
| Marius Hills Hole（JAXA かぐやが発見） | 14.09 | -56.77（303.23E） | -1571 | 392 | 97 | 穴の直径 約 50–65 m、深さ 約 80–90 m（かぐや TC, Haruyama et al. 2009 GRL）/ LROC の立体視では深さ 約 40 m。Trek に `marius_skylight` レイヤーあり |
| Marius Hills 地下の溶岩チューブ | 約 13–15 | 約 -57 | | | | かぐや LRS（月レーダサウンダ）で長さ 約 50 km の空洞を示す反射（Kaku et al. 2017 GRL）。[ISAS の記事](https://www.isas.jaxa.jp/en/topics/001159.html) |
| SLIM 着陸地点 Shioli（JAXA, 2024-01） | -13.32 | 25.25 | -930 | 385 | 94 | |
| Apollo 15（Hadley Rille, 溶岩の流路） | 26.13 | 3.63 | -1925 | 382 | 94 | |

LROC Pits Atlas（穴の一覧）: https://www.lroc.asu.edu/atlases/pits/1

---

## 2. 火星の候補地（座標は Trek の IAU 地名データ、標高はこの作業で MOLA ImageServer から取った値）
経度は東経 ±180 表記（Trek と同じ）。

| 地点 | 種類 | 緯度 | 経度 | MOLA 標高 m | 北海道と比べる観点 |
|---|---|---|---|---|---|
| Jezero（クレーター） | Perseverance、古い湖のデルタ | 18.41 | 77.69 | -2644 | 堆積物、カルデラ湖 |
| Perseverance 着陸地点 | | 18.4447 | 77.4508 | -2566 | |
| Gale（中央丘 Aeolis Mons） | Curiosity | -5.37 | 137.81 | -104 | 層状の堆積物 |
| Curiosity 着陸地点 | | -4.589 | 137.441 | -4500 | |
| Arcadia Planitia | 有人着陸の有力候補（浅い地下の氷、SWIM 計画） | 47.19 | -175.69 | -4100 | 永久凍土、寒冷な平原 |
| Erebus Montes | Arcadia の地下氷の候補地 | 35.66 | -174.98 | -3973 | |
| Deuteronilus Mensae | 有人探査地域 (Exploration Zone) の候補、氷河 | 45.11 | 23.92 | -3123 | 氷河地形、周氷河地形 |
| Protonilus Mensae | 同上 | 43.87 | 48.86 | -2756 | |
| Phlegra Montes | 同上（地下の氷） | 40.40 | 163.71 | -2734 | |
| Hebrus Valles | 有人探査地域の候補（洞窟・穴の候補） | 19.88 | 126.74 | -3622 | 洞窟、溶岩チューブ |
| Arsia Mons | 火山。北側の斜面に穴（"Seven Sisters" 天窓、Cushing et al. 2007） | -8.26 | -120.09 | 16365 | 盾状火山、溶岩チューブ |
| Pavonis Mons | 火山。斜面に天窓（HiRISE） | 1.48 | -112.96 | 13042 | 同上 |
| Mawrth Vallis | 粘土鉱物 | 22.43 | -16.97 | -2917 | 熱水による変質 |
| Meridiani Planitia（Opportunity） | ヘマタイト、硫酸塩 | -1.95 | -5.53（354.47E） | -1384 | 酸性の温泉・鉱山 |
| Utopia Planitia（Zhurong, CNSA） | | 25.07 | 109.93 | -4102 | |
| Elysium Planitia（InSight） | 若い溶岩平原 | 4.50 | 135.62 | -2614 | 若い玄武岩 |
| Acidalia Planitia | | 49.76 | -20.74 | | |

有人着陸の Exploration Zone 候補（2015 年の First Landing Site Workshop で 47 か所）の一覧: https://www.nasa.gov/journeytomars/mars-exploration-zones （200 を確認）。Hebrus Valles、Deuteronilus/Protonilus、Phlegra、Arcadia、Jezero、Gale などが含まれる。

---

## 3. 比較に使える数値（論文と公開データの代表値）
| 指標 | 月（南極の候補地） | 月（海の玄武岩、低緯度） | 火星 | 出典とデータ |
|---|---|---|---|---|
| 傾斜 | Artemis の着陸条件は傾斜 約 8–10° 以下。候補地は尾根の上の平らな所 | 一般に < 5° | 着陸楕円の中は < 15°（MSL/M2020 の条件） | LOLA ClrSlope 16ppd / LOLA+TC Slope 512ppd（**float の生データは ImageServer がなく、タイルはカラー化された画像のみ**）。火星は MOLA roughness と CTX の DEM |
| 粗さ | LOLA roughness（16ppd） | | MOLA の粗さ（Kreslavsky & Head 2000） | タイル `LRO_LOLA_ClrRoughness_Global_16ppd`、`mola_roughness` |
| 温度レンジ | 日の当たる尾根 Tmax 約 210–300 K / Tmin 約 50–90 K（表 1a）。PSR の中は 約 25–90 K（Paige et al. 2010） | Tmax 約 380–390 K / Tmin 約 94–97 K（表 1d） | 地表は 約 150–290 K（緯度と季節による） | Diviner の tbol_max/min ImageServer（点 API あり） |
| 照明 | Shackleton の縁や Connecting Ridge は年間 80–90% ほど日が当たる（Mazarico et al. 2011; Bussey et al. 2010）。Artemis III の条件は 6.5 日続けて日照 | 約 50%（昼夜それぞれ約 14.75 日） | 約 50%（1 sol = 24.6 h） | `LRO_LOLA_Illumination_SPole65S_240m_EQ`（PSR のマスク） |
| 熱慣性 (J m⁻² K⁻¹ s⁻½) | レゴリス 約 50 | 約 50（岩の多い所は高い） | Gale 約 300–400、Jezero 約 300–500、Arcadia 約 200–300、岩盤 > 1200（TES/THEMIS, Putzig & Mellon 2007 など。**概略値**） | `TES_Thermal_Inertia` タイル |
| 組成 | 高地: 斜長岩質 + 永久影の氷 | 海の玄武岩（FeO・TiO₂ が多い） | 玄武岩（輝石、TES_Clinopyroxene）＋粘土・硫酸塩 | Trek の TES 各層、Unified Geologic Map of the Moon |
| 地下の空洞 | | Marius Hills の穴と約 50 km の溶岩チューブ | Arsia/Pavonis の天窓、Hebrus Valles | 表 1d と 2 |

地球側との比較の考え方: 北海道の玄武岩溶岩・溶岩チューブ（例: 羊蹄山、樽前山の周辺）↔ 月の海の玄武岩 / Marius Hills、火星の Tharsis。寒冷地の周氷河地形・永久凍土 ↔ Arcadia、Deuteronilus。温度レンジは地球のほうがはるかに狭いので、「どこが似ていないか」として明記すること（チャレンジの検討事項にも書かれている）。

---

## 4. 連携機関のデータ（ボーナス要素）
| 機関 | データ | URL | 状況 |
|---|---|---|---|
| JAXA | SELENE（かぐや）データアーカイブ（TC/MI/LRS/LALT など、PDS3） | https://darts.isas.jaxa.jp/planet/pdap/selene/ 、FTP 形式の一覧: https://data.darts.isas.jaxa.jp/pub/pds3/ | どちらも 200。ダウンロードは大きいファイルなので**タイルは Trek のかぐや層を使うのがよい** |
| JAXA | かぐや TC オルソモザイクのタイル | 上の表の `Kaguya_TCortho_Mosaic_Global_4096ppd` | 200、CORS `*` |
| JAXA | LOLA+かぐや TC の DEM・傾斜・陰影（60S–60N, 512ppd ≒ 59 m） | `LRO_LOLAKaguya_{DEM,Slope,ClrSlope,Hillshade,ClrHillshade}_60N60S_512ppd` | ClrSlope は 200 で確認 |
| JAXA | かぐや LGM2011 重力 | `Kaguya_LGM2011_*`（Trek） | 検索で確認 |
| JAXA | Marius Hills の溶岩チューブ（LRS） | https://www.isas.jaxa.jp/en/topics/001159.html | |
| JAXA | G-Portal（地球観測、チャレンジ公式の Resources） | https://gportal.jaxa.jp/gpr/index/index | |
| ESA | Mars Express HRSC（MOLA と合わせたもの） | Trek `Mars_MOLA_blend200ppx_HRSC_*`（200）。FU Berlin の HRSC マップサーバー https://maps.planet.fu-berlin.de/ （200） | |
| ESA | Planetary Science Archive (PSA) | https://archives.esac.esa.int/psa/ （200）。`psa.esa.int` は接続できなかった | |
| CNSA | 嫦娥 2 号 CCD のオルソ画像と DEM | Trek `CE2_GRAS_DOM_07m`, `CE2_GRAS_DEM_20m` | 検索で確認 |

Diviner のデータ（PDS Geosciences）: https://pds-geosciences.wustl.edu/missions/lro/diviner.htm （200）、UCLA: https://www.diviner.ucla.edu/data （200）。LROC QuickMap（https://quickmap.lroc.asu.edu/）はこの環境からは接続できなかった。

---

## 5. チャレンジ公式ページ（取得成功）
- **正しい URL**: https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/ （Resources は `?tab=resources`）
  - 依頼にあった `.../identify-earth-locations-that-analog-the-permanent-moon-base-locations-and-mars/` は「Page Not Found」。slug は challenges 一覧のリンクから確認した。
  - curl は SSL 証明書の検証エラー（`unable to get local issuer certificate`）で失敗し、WebFetch も同じエラーだった。サイトは JS で描画するので、内蔵ブラウザで取得した。
- 難易度: Advanced / Intermediate / Beginner/Youth。分野: Earth Science, Planets & Moons, Software, Space Exploration

### Resources（ページの表記どおり。URL の `?utm_source='chatgpt.com'` は省略）
**NASA Data & Resources**
- Earth
  - NASA Earthdata Search — https://search.earthdata.nasa.gov/
  - NASA Worldview — https://worldview.earthdata.nasa.gov/index.html
- Moon and Mars
  - NASA Planetary Data System (PDS) — https://pds.nasa.gov/
  - NASA Lunar Reconnaissance Orbiter (LRO) — https://pds-geosciences.wustl.edu/missions/lro/
  - NASA LRO Diviner Lunar Data — https://pds-geosciences.wustl.edu/missions/lro/diviner.htm （説明文では、極域と資源のプロダクトを寒冷・氷のある地球環境と比較することを勧めている）

**Space Agency Partner Resources**
- CSA
  - RADARSAT Constellation Mission (RCM) - Data — https://donnees-data.asc-csa.gc.ca/en/dataset/rcm
  - RADARSAT 1 - Data — https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1
  - Synthetic Aperture Radar (SAR) Python Tutorial — https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial
- ESA
  - Copernicus Data Space Ecosystem — https://dataspace.copernicus.eu/
  - ESA Open Science Catalog — https://opensciencedata.esa.int/
- JAXA
  - JAXA G-Portal — https://gportal.jaxa.jp/gpr/index/index

（Moon/Mars の具体的なタイルは公式 Resources に入っていないので、上の Trek のデータが実装上のメインになる）

### Potential Considerations（要約）
- 見た目が似ているだけでなく、データで「なぜ類似地なのか」を示す
- 類似の観点: 地質・鉱物・表面の物質 / 地形・標高・傾斜・粗さ・クレーター / 温度・照明・極端な環境 / 水・氷・永久凍土・資源 / 塵・風・浸食 / 生物・極限環境の生物・居住可能性 / 洞窟・溶岩チューブ・地下 / 着陸・移動・ロボットや人の作業・建設の条件
- すべての点で一致しなくてよい。何が・どれだけ似ていて、何が違うかを示す
- 場所だけでなくプロセス（堆積、砂嵐、火山活動、浸食、氷の動き、水による変質）も考える
- 有名な類似地（南極、アタカマ、アイスランド、ハワイ）以外を探す。NASA の全球データで、あまり注目されていない場所を見つける
- 地下を含めて地球全体を探す（極域、砂漠、山、火山、衝突クレーター、塩湖、氷河、洞窟、溶岩チューブ、鉱山）
- 複数のデータを組み合わせる
- スケールを考える（大陸全体ではなく、クレーター・谷・火山地帯など小さい範囲のほうが一致しやすい）
- 探査にどう役立つか（機器の試験、作業の準備、資源や生命の痕跡の探索、リスクの低減）につなげる
- 手法は自由（GIS、統計、類似度の指標、機械学習、アプリ、ゲーム）
- 地球の限界（低重力、真空、薄い大気、放射線は再現できない）を認識する
- 意外な場所・意外なつながりで驚かせる
