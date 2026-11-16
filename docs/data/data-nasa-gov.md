# data.nasa.gov（NASA Open Data Portal）調査メモ

調査日: 2026-11-14 / 目的: 1〜2日の AI/ML ハッカソンですぐ使えるデータセットを探す
※ 下記の URL・サイズ・行数は、すべて当日に実際にリクエストを送って確認した値（HEAD ではなく Range GET を使用。理由は後述）。

---

## TL;DR: おすすめトップ5

| # | データセット | 形式 / サイズ | なぜ良いか | AI アイデア（1行） |
|---|---|---|---|---|
| 1 | **CMAPSS ジェットエンジン劣化シミュレーション** | ZIP 12.4MB（txt 時系列） | ML の定番ベンチマーク。train/test/RUL が分割済み | LSTM/Transformer で残存寿命(RUL)を予測し、異常の説明を LLM で自動生成 |
| 2 | **Meteorite Landings（隕石落下）** | CSV 3.95MB, 45,716行×10列 | クリーンで地理情報付き、可視化映えする | 地点・年・質量から隕石の分類(recclass)を推定 + 地図ダッシュボード |
| 3 | **Mars surface image（Curiosity 画像ラベル付き）** | ZIP 60.6MB（Zenodo）、6,691枚・24クラス | 画像分類にすぐ使える小さめのラベル付きデータ | 火星画像分類器（ファインチューン）+ CLIP による画像検索 |
| 4 | **Global Landslide Catalog（世界地すべりカタログ）** | CSV 8.5MB, 11,033行×31列 | 自由記述テキスト + 位置 + 被害数 | 説明文から誘因・規模を分類 / 死者リスク予測、RAG Q&A |
| 5 | **NASA Patents + TechPort + Open Source Software** | CSV 205KB（1,393行）/ 29MB / 70KB（687行） | テキスト中心で LLM 系の企画に向く | 技術シーズ検索 RAG、「この特許を使ったスタートアップ案」生成 |

次点: Outgassing DB（12,859行、材料物性の回帰）、Fireball（JPL API 版は 1,074件）、EVA 船外活動ログ（375行テキスト）、Li-ion 電池劣化（540MB と大きい）。

---

## 1. プログラムからの検索・ダウンロード方法

### カタログ API（CKAN v3）: 認証不要
- ベース URL: `https://data.nasa.gov/api/3/action/`
- 実際に確認したエンドポイント:
  - `package_search?q=<クエリ>&rows=<件数>&start=<オフセット>`: 全文検索（Solr 構文が使える）
  - `package_show?id=<dataset-name>`: 1件分のメタデータ（resources[].url がファイル URL、extras に landingPage/accessLevel などが入る）
  - `status_show`: サイト情報（datastore/datapusher 拡張が有効）
- 登録データセット数: **36,518件**（2026-11-14時点）。リソース形式の上位は BIN 15,847 / HTML 13,710 / ISO 10,651 / PDF 10,181 / ZIP 2,086 ... つまり**大半は外部ページへのリンクで、直接 CSV があるものは少ない**。
- ファセット: `package_search?rows=0&facet.field=["res_format"]`

```bash
# 検索
curl -s "https://data.nasa.gov/api/3/action/package_search?q=meteorite&rows=5" | jq '.result.results[] | {name, title, res: [.resources[] | {format, url}]}'
# data.nasa.gov 自身がホストしているファイルを持つデータセットだけ（71件）を抜き出す裏技
curl -s "https://data.nasa.gov/api/3/action/package_search?q=res_url:*docs/legacy*&rows=100"
```

### ファイル本体
- 自前ホストのファイルは `https://data.nasa.gov/docs/legacy/<Name>/<Name>_rows.csv` のような形式（`.json/.xml/.rdf` 版もある）。
- アクセスすると **302 で S3 の署名付き URL**（`data-nasa-bucket-production.s3.us-east-1.amazonaws.com`、有効期限1時間）にリダイレクトされる → `curl -L` が必須。
- **HEAD は S3 で 403 になる**（署名が GET 用のため）。サイズを確認したいときは `curl -sL -r 0-0 -o /dev/null -w "%header{content-range}"` を使う。
- Web UI のデータセットページ: `https://data.nasa.gov/dataset/<name>`

```python
import pandas as pd
df = pd.read_csv("https://data.nasa.gov/docs/legacy/meteorite_landings/Meteorite_Landings.csv")  # リダイレクトも自動で追従する
```

---

## 2. データセット一覧（ダウンロード確認済み）

### A. data.nasa.gov に直接ホストされているもの（認証不要・すぐ使える）

| テーマ | データセット（ページ） | 形式 | サイズ / 行数 | 直接 DL URL | AI アイデア |
|---|---|---|---|---|---|
| 隕石 | [Meteorite Landings](https://data.nasa.gov/dataset/meteorite-landings) | CSV/JSON | CSV 3.95MB, 45,716行（name,recclass,mass,fall,year,lat,lon） / JSON 12.6MB | https://data.nasa.gov/docs/legacy/meteorite_landings/Meteorite_Landings.csv | 分類予測・発見確率ヒートマップ・自然言語→SQL での探索 |
| 航空エンジン | [CMAPSS Jet Engine Simulated Data](https://data.nasa.gov/dataset/cmapss-jet-engine-simulated-data) | ZIP（txt） | 12.4MB（FD001〜FD004 の train/test/RUL） | https://data.nasa.gov/docs/legacy/CMAPSSData.zip | RUL 予測、異常検知、予知保全ダッシュボード |
| 地すべり / 防災 | [Global Landslide Catalog Export](https://data.nasa.gov/dataset/global-landslide-catalog-export) | CSV/JSON | 8.5MB, 11,033行×31列（event_description, trigger, size, fatality_count, lat/lon …） | https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv | テキスト分類、被害予測、降雨データとの結合 |
| 特許 | [NASA Patents](https://data.nasa.gov/dataset/nasa-patents) | CSV/JSON | 205KB, 1,393行（Center, Status, Title, 期限…） | https://data.nasa.gov/docs/legacy/NASA_Patents/NASA_Patents_rows.csv | 特許タイトルのクラスタリング、事業化アイデア生成 |
| 技術ポートフォリオ | [NASA TechPort](https://data.nasa.gov/dataset/nasa-techport) | CSV/JSON | CSV 29.3MB | https://data.nasa.gov/docs/legacy/NASA_TechPort/NASA_TechPort_rows.csv | NASA プロジェクト検索 RAG、類似プロジェクト推薦 |
| ソフトウェア | [Open Source And General Resource Software](https://data.nasa.gov/dataset/open-source-and-general-resource-software) | CSV | 70KB, 687行 | https://data.nasa.gov/docs/legacy/Open_Source_And_General_Resource_Software/Open_Source_And_General_Resource_Software_rows.csv | タイトルからカテゴリを自動タグ付け |
| 宇宙飛行士 | [Extra-vehicular Activity (EVA) – US and Russia](https://data.nasa.gov/dataset/extra-vehicular-activity-eva-us-and-russia) | CSV | 98KB, 375行（Crew, Vehicle, Date, Duration, Purpose 自由文） | https://data.nasa.gov/docs/legacy/Extra-vehicular_Activity_EVA_-_US_and_Russia/Extra-vehicular_Activity_EVA_-_US_and_Russia_rows.csv | EVA 目的文の要約・トピック分析、所要時間予測 |
| 材料 | [Outgassing Db](https://data.nasa.gov/dataset/outgassing-db) | CSV | 1.05MB, 12,859行（TML, CVCM, WVR, 用途…） | https://data.nasa.gov/docs/legacy/Outgassing_Db/Outgassing_Db_rows.csv | 宇宙用材料の適否判定（TML<1%, CVCM<0.1%）分類器 |
| 地球近傍天体 | [WISE NEA/Comet Discovery Statistics](https://data.nasa.gov/dataset/wise-nea-comet-discovery-statistics) | CSV | 13KB, 202行（H, MOID, q, Q, i, PHA, Orbit Class） | https://data.nasa.gov/docs/legacy/WISE_NEACOMET_DISCOVERY_STATISTICS/WISE_NEACOMET_DISCOVERY_STATISTICS_rows.csv | 軌道要素から PHA（潜在的に危険な小惑星）を分類（小さすぎるので NeoWs と併用推奨） |
| 彗星 | [Near-Earth Comets – Orbital Elements](https://data.nasa.gov/dataset/near-earth-comets-orbital-elements) | CSV | 25KB, 160行 | https://data.nasa.gov/docs/legacy/Near-Earth_Comets_-_Orbital_Elements/Near-Earth_Comets_-_Orbital_Elements_rows.csv | 軌道の 3D 可視化 + クラスタリング |
| 火球 | [Fireball And Bolide Reports](https://data.nasa.gov/dataset/fireball-and-bolide-reports) | CSV | 6KB, **92行のみ（古い）** | https://data.nasa.gov/docs/legacy/Fireball_And_Bolide_Reports/Fireball_And_Bolide_Reports_rows.csv | → 最新版の JPL API（下表）を使うこと |
| 施設 | [NASA Facilities](https://data.nasa.gov/dataset/nasa-facilities) | CSV | 109KB, 485行 | https://data.nasa.gov/docs/legacy/NASA_Facilities/NASA_Facilities_rows.csv | 施設マップ + チャットボット |
| 予知保全 | [PHM 2008 Challenge](https://data.nasa.gov/dataset/phm-2008-challenge) / [Milling Wear](https://data.nasa.gov/dataset/milling-wear) / [Fatigue Crack Growth](https://data.nasa.gov/dataset/fatigue-crack-growth-in-aluminum-lap-joint) | ZIP | 5.8MB / 15.1MB / 1.9MB | https://data.nasa.gov/docs/legacy/Challenge_Data.zip ・ https://data.nasa.gov/docs/legacy/mill.zip ・ https://data.nasa.gov/docs/legacy/PHMDC2019_Data.zip | CMAPSS の代替・追加検証用 |
| 電池 | [Randomized and Recommissioned Battery Dataset](https://data.nasa.gov/dataset/randomized-and-recommissioned-battery-dataset) | ZIP | **538MB** | https://data.nasa.gov/docs/legacy/battery_alt_dataset.zip | 電池 SOH/RUL 予測（大きいのでチームで1回だけ DL すること） |

### B. data.nasa.gov のカタログから辿れる外部ホスト（確認済み・すぐ使える）

| テーマ | データセット | 形式 | サイズ / 件数 | 直接 URL | 認証 | AI アイデア |
|---|---|---|---|---|---|---|
| 火星画像 | [Mars surface image (Curiosity) labeled v1](https://data.nasa.gov/dataset/mars-surface-image-curiosity-rover-labeled-data-set-version-1) → Zenodo | ZIP（JPEG） | 60.6MB, 6,691枚・24クラス | https://zenodo.org/api/records/1049137/files/msl-images.zip/content | 不要 | 画像分類、ゼロショットの CLIP と比較 |
| 系外惑星 | NASA Exoplanet Archive TAP（カタログ上は HEASARC へのリンク） | CSV/JSON（ADQL） | pscomppars 6,470 惑星 | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name,pl_rade,pl_bmasse,pl_orbper,pl_eqt,disc_year,discoverymethod+from+pscomppars&format=csv` | 不要 | 居住可能性スコアリング、発見手法の分類 |
| 火球 | CNEOS Fireball API (JPL) | JSON | 1,074件（最新は 2026-10-04） | https://ssd-api.jpl.nasa.gov/fireball.api | 不要 | 衝突エネルギー予測、時空間分布 |
| 地球近傍天体 | NeoWs（api.nasa.gov） | JSON | 日付範囲で取得 | `https://api.nasa.gov/neo/rest/v1/feed?start_date=2026-11-01&end_date=2026-11-02&api_key=DEMO_KEY` | DEMO_KEY で可（無料キー推奨） | 危険度（is_potentially_hazardous）分類 |
| 山火事 | FIRMS MODIS 全球 過去24時間 | CSV | 1.4MB（毎日更新） | https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv | 24h CSV は不要（期間指定の API は MAP_KEY が必要） | 火災クラスタ検出、FRP 予測、気象との結合 |
| 気候 | GISTEMP v4 全球気温偏差 | CSV | 13KB（1880年〜の月次） | https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv | 不要 | 時系列予測、温暖化の可視化（※ data.nasa.gov で "GISTEMP" を検索しても 0件） |

---

## 3. 注意点（Gotchas）

- **カタログの大半は「リンク集」**: 36.5k件のうちほとんどが BIN/HTML/PDF で、Earthdata（ORNL DAAC など）の `.../protected/...` は **Earthdata Login（無料登録）が必要**。山火事系（iWED など）の ZIP はほぼ protected。時間のないハッカソンでは避けるのが無難。
- **`num_resources=0` のデータセットが多い**（PDS アーカイブ系、`c-mapss-aircraft-engine-simulator-data`、`li-ion-battery-aging-datasets` など）。必ず `package_show` で resources/landingPage を確認すること。
- **旧 Socrata API は終了済み**: `https://data.nasa.gov/resource/<id>.json` と `/api/views/<id>/rows.csv` は **404**。古いチュートリアルのコードは動かない。代わりに `/docs/legacy/...` を使う。
- **DASHlink（c3.nasa.gov/dashlink）は到達不能（502/タイムアウト）**: ASRS や電池系の多くのリソースがここを指しているので実質デッドリンク。
- **C-MAPSS 「シミュレータ本体」は non-public**（データの CMAPSSData.zip は取得できる）。
- **HEAD 403**: S3 の署名付き URL は GET でのみ有効。リンク切れと誤判定しないこと。署名の有効期限は1時間なので、URL を保存せず毎回 `data.nasa.gov/docs/legacy/...` から取得し直すこと。
- **空・ゴミデータあり**: `NASA_Disasters_Mapping_Portal_rows.csv` は **1バイト（空）**。`Testing Now` / `SxSW 2016 Leads` などのテスト・無関係なデータセットも混ざっている。
- **古いデータ**: data.nasa.gov 版の Fireball は 92行・2009年頃で止まっている → JPL API を使う。Mars Rover Photos API は api.nasa.gov 経由（landingPage のみ）。
- **巨大ファイル**: IMS Bearings `IMS.zip` は **1.06GB**、電池データは 446〜538MB。リポジトリにはコミットせず `.gitignore` に入れたディレクトリ（例: `data/raw/`）に置くこと。
- API が時々 **502 / IncompleteRead** を返す → リトライを入れること。ダウンロードも遅め（数MBで数十秒かかることがある）。
- ライセンス: 多くは `License not specified`（NASA のデータは原則パブリックドメインだが、外部ホストのもの（Zenodo など）は各ライセンスを確認すること）。

## 4. その他の候補（未検証・参考）
- Ames 系の予知保全 ZIP: IGBT Accelerated Aging、Capacitor Electrical Stress、Small Satellite Power Simulation（`res_url:*docs/legacy*` の検索で見つかる）
- GeneLab / OSDR（宇宙飛行士・宇宙生物学のオミクスデータ）: osdr.nasa.gov。データ量が多く前処理が重い
- Gateway to Astronaut Photography of Earth: ISS から撮影した写真（カタログ上はリソースなし）
