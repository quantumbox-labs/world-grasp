# NASA Earthdata 調査メモ(AIハッカソン向け)

調査日: 2026-11-14 / concept ID・最新グラニュール・API 動作はすべてこの日に CMR などへ実際にリクエストして確認済み。

- Earthdata Search(GUI): https://search.earthdata.nasa.gov
- 中身は **CMR (Common Metadata Repository)**: `https://cmr.earthdata.nasa.gov/search/collections.json?keyword=...`
  - 検索(メタデータ)は **ログイン不要**。データ本体のダウンロードは多くが **Earthdata Login (URS) 必須**。

---

## TL;DR: まずはこの 5 つ

| # | データ / サービス | なぜ推すか | ログイン |
|---|---|---|---|
| 1 | **NASA POWER API**(地点の気象・日射) | REST で JSON が即返る。キー不要。1980年以降の日次 T2M・降水・日射。時系列予測、太陽光発電量推定などがすぐ作れる | 不要 |
| 2 | **FIRMS アクティブファイア**(VIIRS/MODIS) | 直近 24h/48h/7d の全球 CSV がキーなしで取れる(NOAA-20 24h ≈ 7.6MB)。点データなので扱いやすい | CSV: 不要 / API: MAP_KEY |
| 3 | **GIBS / Worldview タイル** | 1000超のレイヤーを JPEG/PNG の WMTS タイルで取得。画像分類・変化検知・デモの背景地図に最適 | 不要 |
| 4 | **GPM IMERG 日降水量**(`GPM_3IMERGDL`) | 0.1°・全球・1ファイル ≈ 25MB の NetCDF4。Late 版は約1–2日遅れで更新(2026-11-12 分まで確認) | 必要 |
| 5 | **HLS (Harmonized Landsat Sentinel-2)** | 30m・COG(GeoTIFF)・バンド別ファイルなので部分読みが速い。土地被覆分類・作物・洪水のCV/基盤モデル(Prithvi)向け | 必要 |

迷ったら: **ログイン不要の 1–3 でプロトタイプ → 余裕があれば 4–5 を earthaccess で追加**。

---

## 1. アクセス方法の整理

### ログイン要否まとめ

| ツール / エンドポイント | ログイン | 確認結果 / メモ |
|---|---|---|
| CMR Search API(collections / granules 検索) | 不要 | 動作確認済。短時間に連続で叩くと **HTTP 403 が断続的に返る**(レート制限)。リトライ+スリープ推奨 |
| Earthdata Search(GUI での検索) | 不要(ダウンロード時に要ログイン) | |
| データ本体 (`data.*.earthdatacloud.nasa.gov`, `archive.podaac...` 等) | **必要** | 未認証アクセスは 403/URS リダイレクト(確認済: LP DAAC は CloudFront 403) |
| **earthaccess**(Python) | 必要(検索だけなら不要) | `earthaccess.login()` で `~/.netrc` か環境変数 `EARTHDATA_USERNAME/PASSWORD` を使う |
| **GIBS WMTS/WMS**(`gibs.earthdata.nasa.gov`) | 不要 | 確認済: MODIS True Color タイルが 200 / image/jpeg |
| Worldview(https://worldview.earthdata.nasa.gov) | 不要 | GIBS のビューア。レイヤー名を調べるのに便利 |
| **NASA POWER API**(`power.larc.nasa.gov`) | 不要・キー不要 | 確認済: 東京の日次 T2M/降水/日射が JSON で返る(API v2.10.3, ソース MERRA2/CERES SYN1DEG) |
| **FIRMS** | CSV ダウンロード: 不要 / Area API: **MAP_KEY 必要** | 確認済: 無効キーで `Invalid MAP_KEY.`(400)。MAP_KEY は https://firms.modaps.eosdis.nasa.gov/api/map_key/ でメール登録のみ・無料。10分あたりのトランザクション上限あり |
| **AppEEARS**(https://appeears.earthdatacloud.nasa.gov) | 必要 | 地点/ポリゴン指定で MODIS/VIIRS/HLS/SMAP 等を切り出し → CSV/GeoTIFF/NetCDF。非同期ジョブ(数分〜数時間)なので **初日の朝に投げておく** |
| **Giovanni**(https://giovanni.gsfc.nasa.gov) | 必要 | ブラウザで地図/時系列/平均を作れる。降水・エアロゾル・NO2 の傾向把握に。CSV/NetCDF 出力可 |
| OPeNDAP / Harmony(サブセット) | 必要 | 変数・範囲を絞ってダウンロード。大きいファイルの回避策 |

### Earthdata Login (URS) の準備
1. https://urs.earthdata.nasa.gov で無料アカウント作成(各自で行う)。
2. `~/.netrc` に `machine urs.earthdata.nasa.gov login <USER> password <PASS>` を書く(`chmod 600`)。または `earthaccess.login(persist=True)`。
3. GES DISC(GPM, MERRA-2, OMI, TROPOMI)は初回に「NASA GESDISC DATA ARCHIVE」アプリの承認が必要な場合あり(URS のプロフィール → Applications)。ダウンロードで 401/リダイレクトループが出たらこれを疑う。

---

## 2. 推奨コレクション / サービス一覧(concept ID は CMR で確認済)

| 分野 | Short name (ver) | Concept ID | 形式 | 解像度 / 頻度 | 1ファイル目安 | ログイン | 一番楽な取得経路 | AI アイデア |
|---|---|---|---|---|---|---|---|---|
| 気象・日射(点) | NASA POWER API | — | JSON/CSV | 0.5°×0.625°(MERRA-2) 日次/時別 | 数KB | 不要 | REST 直叩き | 太陽光発電量・熱中症リスクの時系列予測 |
| 火災 | VIIRS NOAA-20 / S-NPP NRT(FIRMS)<br>`VNP14IMGTDL_NRT` (2) | C1942970257-LANCEMODIS | CSV/SHP/KML | 375m 点データ・NRT | 24h 全球 ≈ 7.6MB | CSV不要 / API要MAP_KEY | FIRMS CSV / Area API | 火災拡大予測(+POWER の風・湿度) |
| 火災(履歴) | MOD14A1 (061) | C2565791013-LPCLOUD | HDF4 | 1km 日次 | 数MB/タイル | 必要 | AppEEARS | 火災発生リスク分類 |
| 焼失域 | MCD64A1 (061) | C2565786756-LPCLOUD | HDF4 | 500m 月次 | 数MB/タイル | 必要 | AppEEARS | 焼失域セグメンテーションの教師ラベル |
| 植生 | MOD13Q1 (061) NDVI/EVI | C1748066515-LPCLOUD | HDF4 | 250m 16日 | ≈ 42MB/タイル | 必要 | AppEEARS(地点CSV) / earthaccess | 作物収量・干ばつ予測 |
| 植生 | VNP13A1 (002) VIIRS NDVI | C2519127224-LPCLOUD | HDF5 | 500m 16日 | 数十MB | 必要 | AppEEARS | MODIS 後継として長期時系列 |
| 地表面温度 | MOD11A1 (061) | C1748058432-LPCLOUD | HDF4 | 1km 日次 | ≈ 1MB/タイル | 必要 | AppEEARS / earthaccess | 都市ヒートアイランド推定 |
| 地表面温度 | VNP21A1D (002) | C2545314555-LPCLOUD | HDF5 | 1km 日次 | 数MB | 必要 | AppEEARS | 同上(VIIRS) |
| 降水 | **GPM_3IMERGDL (07)** Late 日次 | C2723754859-GES_DISC | NetCDF4 | 0.1° 日次(NRT, 2026-11-12分まで有) | ≈ 25MB | 必要 | earthaccess + xarray | 洪水・土砂災害の早期警戒 |
| 降水 | GPM_3IMERGDF (07) Final 日次 | C2723754864-GES_DISC | NetCDF4 | 0.1° 日次(研究品質、**2025-09-30 で終了表示**) | ≈ 25MB | 必要 | 同上 | 長期学習データ |
| 降水 | GPM_3IMERGM (07) 月次 | C2723754851-GES_DISC | HDF5 | 0.1° 月次 | 小 | 必要 | 同上 / Giovanni | 気候トレンド |
| 海面水温 | MUR-JPL-L4-GLOB-v4.1 | C1996881146-POCLOUD | NetCDF4 | 0.01°(1km) 日次 | **≈ 690MB/日** | 必要 | earthaccess.open + xarray で範囲だけ読む | 海洋熱波・漁場予測 |
| 大気 NO2 | S5P_L2__NO2____HiR (2) / **(3)** TROPOMI | C2089270961-GES_DISC / C4392195862-GES_DISC | NetCDF4 (L2, 軌道) | 5.5×3.5km | **≈ 590MB/軌道** | 必要 | Giovanni / Harmony サブセット | 都市排出量推定・ロックダウン解析 |
| 大気 NO2 | OMNO2d (003 / 004) OMI 日次 L3 | C1266136111-GES_DISC / C3333493715-GES_DISC | HDF5 | 0.25° 日次 | 小(数MB) | 必要 | earthaccess / Giovanni | 長期(2004–)NO2 トレンド |
| 大気 NO2 | TEMPO_NO2_L3 (V04) | C3685896708-LARC_CLOUD | NetCDF4 | 約2km・**1時間毎**(北米のみ) | 大 | 必要 | earthaccess | 北米の日内大気汚染予測 |
| エアロゾル | M2T1NXAER (5.12.4) MERRA-2 | C1276812830-GES_DISC | NetCDF4 | 0.5°×0.625° 1時間 | ≈ 480MB/日 | 必要 | Giovanni / OPeNDAP で変数絞り | PM2.5 推定・黄砂/煙予測 |
| 夜間光 | **VNP46A2 (2)** Black Marble 日次 | C3365931269-LAADS | HDF5 | 15″(≈500m) 日次 | ≈ 18MB/タイル | 必要 | earthaccess | 停電検知・災害後の復旧度推定 |
| 夜間光 | VNP46A3 (2) 月次 | C3860061042-LAADS | HDF5 | 15″ 月次 | 中 | 必要 | earthaccess | 経済活動・人口推定 |
| 高解像度光学 | **HLSL30 (2.0)** Landsat | C2021957657-LPCLOUD | **COG (GeoTIFF)** バンド別 | 30m 2–3日 | 数MB〜数十MB/バンド | 必要 | earthaccess + rioxarray(COG部分読み) | 土地被覆分類・作物判別(Prithvi 微調整) |
| 高解像度光学 | **HLSS30 (2.0)** Sentinel-2 | C2021957295-LPCLOUD | COG | 30m | 同上 | 必要 | 同上 | 同上 |
| 水域 | OPERA_L3_DSWX-HLS_V1 (1.0) | C2617126679-POCLOUD | COG | 30m | 小 | 必要 | earthaccess | 洪水マップ(ラベルとして使える) |
| 土壌水分 | SPL3SMP_E (006) | C2938664763-NSIDC_CPRD | HDF5 | 9km 日次 | **≈ 620MB** | 必要 | AppEEARS(地点抽出推奨) | 干ばつ・作物ストレス |
| 土壌水分 | SPL3SMP (009) | C2938664585-NSIDC_CPRD | HDF5 | 36km 日次 | 中 | 必要 | AppEEARS | 同上(軽量版) |
| 土壌水分 | SPL4SMGP (008) L4 | C3480440870-NSIDC_CPRD | HDF5 | 9km 3時間(モデル同化・欠損なし) | 大 | 必要 | AppEEARS | 欠損なしで ML の入力にしやすい |
| 海面高度 | NASA_SSH_REF_SIMPLE_GRID_V1 (1) | C3309442935-POCLOUD | NetCDF4 | 0.5° 約5日毎 | **≈ 1MB** | 必要 | earthaccess + xarray | 海面上昇トレンド・高潮リスク |
| 画像タイル | GIBS (例: `MODIS_Terra_CorrectedReflectance_TrueColor`) | — | JPEG/PNG (WMTS) | 250m〜 | 数十KB/タイル | 不要 | WMTS URL 直叩き | 画像分類・雲/煙検出のデモ |

> **注意:** 表の Short name は大文字小文字・アンダースコア数が厳密(`S5P_L2__NO2____HiR` は `_` が 2 個+4 個)。迷ったら concept ID で検索する方が確実。

---

## 3. ハマりどころ(Gotchas)

1. **ファイルが大きい**: MUR SST 690MB/日、SMAP L3E 620MB/日、TROPOMI 590MB/軌道、MERRA-2 480MB/日。**リポジトリにダウンロードしない**(`data/` を `.gitignore`、もしくは `~/earthdata_cache` へ)。範囲・変数を絞る手段(AppEEARS / Giovanni / Harmony / OPeNDAP / `earthaccess.open()` + xarray の遅延読み込み)を優先。
2. **形式がバラバラ**:
   - HDF4(MODIS `.hdf`): `xarray` では読めないことが多い → `rioxarray.open_rasterio()`(GDAL の HDF4 ドライバ必要)、`pyhdf`、または AppEEARS で GeoTIFF に変換。
   - HDF5 / NetCDF4: `xarray.open_dataset(..., engine="h5netcdf")`。VIIRS / SMAP は **グループ構造**なので `group="HDFEOS/GRIDS/..."` 指定や `h5py` で中身確認が必要。
   - COG(HLS / OPERA): `rioxarray` で窓読み可能。最速。
3. **MODIS/VIIRS の SIN グリッド**: タイル名 `h29v05` のようなシヌソイダル投影。緯度経度に直すには再投影が必要 → AppEEARS で地理座標出力にすると楽。日本(本州)は概ね `h28v05`/`h29v05`。
4. **スケール係数・フィル値**: NDVI は ×0.0001、LST は ×0.02(K)など。`mask_and_scale=True` を忘れると値が変。
5. **クラウドホスト(AWS us-west-2)**: 今回確認したコレクションはほぼ全部 `cloud_hosted=true`。`s3://` 直アクセス(`earthaccess.open()` の in-region 最適化)は **us-west-2 の EC2 / SageMaker 等から実行した時だけ**有効。ローカル PC や他リージョンからは HTTPS 経由(earthaccess が自動判定)になり、egress 的に遅い。大量処理するなら us-west-2 にノートブック環境を立てる。S3 一時認証は 1 時間で失効。
6. **CMR のレート制限**: 連続リクエストで 403 が断続的に返った(今回の調査で実際に発生)。ループ検索は `sleep` + リトライを入れる。
7. **NRT と Final の違い**: IMERG Final は約3.5ヶ月遅れ(現状 2025-09-30 まで表示)、直近を使うなら Late(`GPM_3IMERGDL`)か Early。FIRMS の NRT は約3時間遅れ。
8. **FIRMS の S-NPP 24h CSV が空の日がある**: 確認時、S-NPP の 24h CSV はヘッダーのみ(112 bytes)、NOAA-20 は 7.6MB。**NOAA-20 / NOAA-21 も併用**すること。
9. **TROPOMI はバージョン 2→3 の移行期**: V3 (`C4392195862-GES_DISC`) が存在。新しい日付は V3 側を確認。
10. **雲**: 光学(HLS, MODIS NDVI, LST)は雲でマスクされる。HLS は `Fmask` バンドで雲除去。欠損に強いモデル or 合成(コンポジット)前提で設計する。

---

## 4. コードスニペット

### 4.1 earthaccess: 検索 + ダウンロード(GPM IMERG Late 日次、東京周辺)

```python
# pip install earthaccess xarray h5netcdf
import earthaccess
import xarray as xr

earthaccess.login()  # ~/.netrc か EARTHDATA_USERNAME/PASSWORD を使用(なければ対話入力)

results = earthaccess.search_data(
    short_name="GPM_3IMERGDL",          # concept_id="C2723754859-GES_DISC" でも可
    version="07",
    temporal=("2026-11-01", "2026-11-07"),
    bounding_box=(138.5, 35.0, 140.5, 36.5),  # (W, S, E, N)
)
print(len(results), "granules")

# ローカル保存(リポジトリ外へ!)
files = earthaccess.download(results, local_path="~/earthdata_cache/imerg")

ds = xr.open_mfdataset(files, engine="h5netcdf")
tokyo = ds["precipitation"].sel(lat=35.69, lon=139.69, method="nearest")
print(tokyo.to_series())

# 大きいファイルはダウンロードせずストリーミング読み込みも可(us-west-2 なら S3 直):
# fobjs = earthaccess.open(results); ds = xr.open_mfdataset(fobjs, engine="h5netcdf")
```

### 4.2 NASA POWER API(ログイン・キー不要)

```python
# pip install requests pandas
import requests, pandas as pd

url = "https://power.larc.nasa.gov/api/temporal/daily/point"
params = {
    "parameters": "T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M",
    "community": "RE",          # RE=再エネ, AG=農業, SB=建築
    "latitude": 35.69, "longitude": 139.69,
    "start": "20250101", "end": "20251031",
    "format": "JSON",
}
r = requests.get(url, params=params, timeout=60)
r.raise_for_status()
p = r.json()["properties"]["parameter"]
df = pd.DataFrame(p)
df.index = pd.to_datetime(df.index, format="%Y%m%d")
df = df.replace(-999.0, pd.NA)   # fill_value
print(df.tail())
```
確認済みレスポンス例(2025-11-01 東京): `T2M=17.34 °C, PRECTOTCORR=25.12 mm/day, ALLSKY_SFC_SW_DWN=2.33 kWh/m²/day`。
時別は `/api/temporal/hourly/point`、月次は `/api/temporal/monthly/point`、領域は `/api/temporal/daily/regional`。

### 4.3 おまけ: FIRMS / GIBS / CMR を curl で

```bash
# FIRMS: キー不要の全球 24h CSV(NOAA-20 VIIRS)
curl -O https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv
# FIRMS Area API(MAP_KEY 必須): /api/area/csv/{MAP_KEY}/{SOURCE}/{W,S,E,N}/{DAYS}
curl "https://firms.modaps.eosdis.nasa.gov/api/area/csv/$FIRMS_MAP_KEY/VIIRS_NOAA20_NRT/129,30,146,46/1"

# GIBS: WMTS タイル(ログイン不要)  .../{Layer}/default/{YYYY-MM-DD}/{TileMatrixSet}/{z}/{row}/{col}.jpg
curl -o tile.jpg "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2025-11-01/250m/2/1/3.jpg"

# CMR: キーワード検索 / short_name 検索(ログイン不要)
curl "https://cmr.earthdata.nasa.gov/search/collections.json?keyword=night%20lights&page_size=5"
curl "https://cmr.earthdata.nasa.gov/search/collections.json?short_name=HLSL30"
curl "https://cmr.earthdata.nasa.gov/search/granules.json?collection_concept_id=C2021957657-LPCLOUD&bounding_box=139,35,140,36&sort_key=-start_date&page_size=1"
```

---

## 5. 2日間での進め方の目安

- **Day 1 午前**: URS アカウント作成・`.netrc` 設定、AppEEARS ジョブを投げる(時間がかかる)。POWER / FIRMS / GIBS で即プロトタイプ。
- **Day 1 午後**: earthaccess で IMERG / Black Marble / HLS の小さい範囲を取得し xarray/rioxarray で前処理。
- **Day 2**: モデル学習(時系列なら LightGBM/LSTM、画像なら Prithvi/U-Net 微調整)とデモ(Worldview/GIBS タイルを背景に)。
