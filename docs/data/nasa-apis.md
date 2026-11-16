# NASA Open APIs 実地調査（2026-11-14）

> 2026-11-14 に DEMO_KEY で実際に curl して確認した結果です（基本は API ごとに 1 リクエスト）。HTTP ステータスは実測値です。
> 生のレスポンスは保存していません。下のサンプルは実レスポンスを短く切り詰めたものです。

## API キーについて（最初に読む）

- **DEMO_KEY**: 登録不要ですが、**実測ではレスポンスヘッダが `x-ratelimit-limit: 10`** でした（ドキュメント上は 30 回/時・50 回/日/IP）。ハッカソン会場では全員が同じ IP を共有するので、**すぐに 429 になります**。
- **個人キー（無料）**: https://api.nasa.gov のフォームに名前とメールを入れるだけで、**その場でメールにキーが届きます**。上限は 1,000 回/時です。**チーム全員がそれぞれ取得してください**。`.env` に `NASA_API_KEY=...` として入れ、コミットしないこと。
- キーが必要なのは `api.nasa.gov` 配下だけです。EONET / images-api / Exoplanet / JPL SSD / GIBS / TLE / EPIC 画像アーカイブは**キーなし**で使えます。

## ステータス一覧

| API | エンドポイント（テストしたもの） | キー | HTTP | 状態 | 主なフィールド | AI プロジェクト案（1 行） |
|---|---|---|---|---|---|---|
| APOD | `api.nasa.gov/planetary/apod` | 要 | 200 | ✅ 動く（※当日分は `title:"NASA Science"`、`url` がテーマ画像になっていてメタデータが壊れていた） | date, title, explanation, url, hdurl, media_type | 毎日の天文写真を LLM がやさしく解説・多言語化する |
| Asteroids NeoWs | `api.nasa.gov/neo/rest/v1/feed` | 要 | 200 | ✅ 動く（2 日分で 13 件） | element_count, near_earth_objects[date][].{estimated_diameter, is_potentially_hazardous_asteroid, close_approach_data[].miss_distance/relative_velocity} | 接近する小惑星の危険度を自然言語で説明するボット |
| DONKI（宇宙天気） | `api.nasa.gov/DONKI/CME`, `/DONKI/FLR` | 要 | CME 200 / **FLR 404** | ⚠️ 一部だけ動く（CME は 34 件取れた。FLR は `/DONKI-API/get/FLR/` が 404。直接アクセスする `kauai.ccmc.gsfc.nasa.gov` はプロキシ経由で 502 だった） | activityID, startTime, sourceLocation, instruments, cmeAnalyses, linkedEvents | CME からオーロラ・通信障害を予報して要約する |
| EONET v3（自然災害イベント） | `eonet.gsfc.nasa.gov/api/v3/events` | 不要 | 200 | ✅ 動く | events[].{id, title, categories, sources, geometry[].{date, coordinates, magnitudeValue}} | 山火事・火山・嵐を地図に出し、LLM で状況をまとめる |
| EPIC（DSCOVR の地球全景） | `api.nasa.gov/EPIC/api/natural` + `epic.gsfc.nasa.gov/archive/...` | API は要 / 画像は不要 | 200 / 200 | ✅ 動く（最新は 2026-11-11 撮影の 12 枚） | identifier, image, date, centroid_coordinates, *_j2000_position | 地球全景画像から雲量や昼夜を推定する VLM デモ |
| Earth（Landsat 画像） | `api.nasa.gov/planetary/earth/assets` | 要 | **503** | ❌ 動かない（upstream connect error。以前から不安定で、事実上終了） | — | → 代わりに GIBS を使う |
| Mars Rover Photos | `api.nasa.gov/mars-photos/api/v1/...` | 要 | **404** | ❌ 終了（Heroku の "No such app"） | — | 使わない |
| InSight 火星天気 | `api.nasa.gov/insight_weather/` | 要 | 200 | 🧊 データが止まっている（中身は sol 675 = 2020-10 のまま。ミッションは 2022 年に終了） | sol_keys, {sol}.{AT,HWS,PRE}.{av,mn,mx}, Season | 過去データとしてなら使える（新しいデータはない） |
| TechTransfer | `api.nasa.gov/techtransfer/...` → 302 → `technology.nasa.gov/api/api/patent/{q}` | 不要（移転先） | 302 → 200 | ✅ 動く（移転先を直接呼ぶ。"engine" で 32 件） | results[][], count, total, perpage（結果は配列の配列で、HTML の highlight タグを含む） | NASA 特許をスタートアップのアイデアとマッチングする RAG |
| Techport | `api.nasa.gov/techport/api/projects?updatedSince=` | 要 | 200 | ✅ 動く | projects[].{projectId, lastUpdated}（詳細は `/projects/{id}`） | NASA 技術プロジェクトの検索・要約エージェント |
| NASA Image & Video Library | `images-api.nasa.gov/search` | 不要 | 200 | ✅ 動く（"apollo 11" で 1,522 件） | collection.items[].{data[].{nasa_id,title,description,keywords,date_created}, links[].href} | 画像と説明文のマルチモーダル検索・ストーリー生成 |
| Exoplanet Archive（TAP） | `exoplanetarchive.ipac.caltech.edu/TAP/sync?query=ADQL&format=json` | 不要 | 200 | ✅ 動く | `ps` テーブル: pl_name, hostname, disc_year, pl_rade, pl_eqt ほか多数 | 自然言語を ADQL に変換して系外惑星データに質問できる |
| JPL SBDB | `ssd-api.jpl.nasa.gov/sbdb.api?sstr=` | 不要 | 200 | ✅ 動く | object.{fullname,neo,pha,orbit_class}, orbit.{moid,elements[]} | 小天体の軌道を可視化して解説する |
| JPL CAD（接近データ） | `ssd-api.jpl.nasa.gov/cad.api` | 不要 | 200 | ✅ 動く（30 日・0.05au 以内で 29 件） | fields[], data[][]（des, cd, dist, v_rel, h） | 「今月地球に近づく天体」のニュースを自動生成 |
| JPL Fireball（火球） | `ssd-api.jpl.nasa.gov/fireball.api` | 不要 | 200 | ✅ 動く（最新は 2026-10-04） | fields[], data[][]（date, energy, impact-e, lat/lon, alt, vel） | 火球の発生地点を地図に出し、異常検知する |
| JPL Sentry（衝突リスク） | `ssd-api.jpl.nasa.gov/sentry.api` | 不要 | 200 | ✅ 動く（2,251 天体、約 590KB） | data[].{des, ip, ps_cum, ts_max, diameter, range} | 衝突リスクをランキングし、LLM で説明する |
| GIBS（衛星画像タイル） | `gibs.earthdata.nasa.gov/wmts/...` (WMTS/WMS) | 不要 | 200 | ✅ 動く（**範囲外のタイル座標を指定すると CloudFront の 403 になる**ので注意） | JPEG/PNG のタイル、WMTSCapabilities.xml | 毎日の衛星画像から山火事の煙や洪水を検出する |
| TLE（衛星の軌道要素） | `tle.ivanstanojevic.me/api/tle/{norad_id}` | 不要 | 200 | ✅ 動く（第三者運営。ISS は 2026-11-13 更新） | satelliteId, name, date, line1, line2 | ISS が見える時刻を予測して通知するエージェント |

**まとめ**: 動くもの 14 / 一部だけ動くもの 1（DONKI）/ 終了 2（Mars Rover Photos、Earth imagery）/ データが止まっているもの 1（InSight）。

### レート制限のメモ
- `api.nasa.gov`: DEMO_KEY は実測で `x-ratelimit-limit: 10`（`x-ratelimit-remaining` の値はバックエンドごとにばらついていた）。個人キーなら 1,000 回/時。
- JPL SSD API: 明記された上限はありませんが、同時リクエストは控えめに（1 つずつ順番に）。
- images-api / EONET / Exoplanet TAP / GIBS: キー不要。常識的な範囲で使えば問題ありません。結果はキャッシュしておくのがおすすめです。

---

## おすすめトップ 5

### 1. JPL SSD/CNEOS（cad + sentry + sbdb + fireball）— キー不要・高速・最新
接近・衝突リスク・軌道・火球がそろったデータセットです。どれも 1 秒以内に返ってきました。「小天体リスクを解説する AI」が作りやすいです。
```bash
curl "https://ssd-api.jpl.nasa.gov/cad.api?date-min=2026-11-14&date-max=2026-12-14&dist-max=0.05"
```
```json
{"signature":{"version":"1.5","source":"NASA/JPL SBDB Close Approach Data API"},"count":29,
 "fields":["des","orbit_id","jd","cd","dist","dist_min","dist_max","v_rel","v_inf","t_sigma_f","h"],
 "data":[["2026 VV15","1","2461358.80","2026-Nov-14 07:16","0.01055","0.01052","0.01059","14.97","14.95","< 00:01","26.033"], ...]}
```
（`dist` の単位は au です。`h` は絶対等級で、小さいほど大きな天体です。sbdb で `sstr=Apophis` とすると `pha:true, moid:0.000108` が返ります。）

### 2. EONET v3 — キー不要・リアルタイムの自然災害
```bash
curl "https://eonet.gsfc.nasa.gov/api/v3/events?limit=3&status=open"
```
```json
{"title":"EONET Events","events":[{"id":"EONET_26331","title":"Wildfire Red Hill, Perry, Mississippi",
  "categories":[{"id":"wildfires","title":"Wildfires"}],
  "sources":[{"id":"IRWIN","url":"https://irwin.doi.gov/observer/incidents/2026-MSMNF-000713"}],
  "geometry":[{"magnitudeValue":519.00,"magnitudeUnit":"acres","date":"2026-11-12T00:22:00Z","type":"Point","coordinates":[-89.063853,31.130069]}]}, ...]}
```
GIBS のタイル（同じ日付・同じ座標）と組み合わせると、「イベント → 衛星画像 → VLM で被害を推定する」流れが作れます。

### 3. NASA Image & Video Library — キー不要・マルチモーダル
```bash
curl "https://images-api.nasa.gov/search?q=apollo%2011&media_type=image&page_size=2"
```
```json
{"collection":{"metadata":{"total_hits":1522},"items":[{"href":"https://images-assets.nasa.gov/image/jsc2007e034221/collection.json",
  "data":[{"center":"JSC","date_created":"1969-07-11T00:00:00Z","keywords":["Apollo","Apollo 11","Launch"],
           "media_type":"image","nasa_id":"jsc2007e034221","title":"Apollo 11 spacecraft pre-launch","description":"Personnel atop the 402-ft. ..."}],
  "links":[{"href":"https://images-assets.nasa.gov/image/jsc2007e034221/jsc2007e034221~medium.jpg","rel":"alternate","render":"image"}]}]}}
```
画像と説明文がペアになっているので、埋め込み検索や画像キャプションの評価に向いています。

### 4. NASA Exoplanet Archive（TAP / ADQL）— キー不要・自然言語→SQL 向き
```bash
curl "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+top+3+pl_name,hostname,disc_year,pl_rade,pl_eqt+from+ps+where+default_flag=1&format=json"
```
```json
[{"pl_name":"Kepler-992 b","hostname":"Kepler-992","disc_year":2016,"pl_rade":1.62,"pl_eqt":null},
 {"pl_name":"TOI-6647 b","hostname":"TOI-6647","disc_year":2026,"pl_rade":3.97,"pl_eqt":null}]
```
LLM が ADQL を書いて実行する「系外惑星アナリスト」エージェントにぴったりです。`ps` は惑星ごとに複数行あるので、`default_flag=1` で 1 行に絞ります。`pscomppars` テーブルも使えます。

### 5. EPIC（DSCOVR の地球全景）— 毎日の「青い地球」画像
```bash
curl "https://api.nasa.gov/EPIC/api/natural?api_key=$NASA_API_KEY"
# 画像（キー不要）: https://epic.gsfc.nasa.gov/archive/natural/2026/11/11/png/epic_1b_20261111001752.png  （thumbs/ や jpg/ もある）
```
```json
[{"identifier":"20261111001752","caption":"This image was taken by NASA's EPIC camera onboard the NOAA DSCOVR spacecraft",
  "image":"epic_1b_20261111001752","version":"04","date":"2026-11-11 00:13:03",
  "centroid_coordinates":{"lat":-10.979004,"lon":162.473145},
  "dscovr_j2000_position":{"x":-1150143.87,"y":-854428.03,"z":-275073.49}, ...}]
```
VLM で雲や地域を当てるデモ、タイムラプス、地球のどちら側が写っているかの解説などに使えます。

**次点**: NeoWs（小天体の直径や危険フラグが入っていて分かりやすい。JPL と組み合わせる）、GIBS（衛星画像の主力。`/wmts/epsg3857/best/BlueMarble_ShadedRelief/default/GoogleMapsCompatible_Level8/1/0/0.jpeg` で 200 を確認）、APOD（定番だが、当日分はメタデータが壊れていたので取得結果を検証すること）、TLE（ISS 追跡）。

## 使わないもの・注意点
- **Mars Rover Photos**: 404（Heroku の "No such app"）。終了しています。火星の画像は images-api で `q=curiosity` などで探します。
- **Earth/Landsat imagery**: 503。代わりに GIBS（MODIS/VIIRS/Landsat のレイヤー）を使います。
- **InSight weather**: 200 を返しますが、2020 年で止まった過去データです。
- **DONKI**: `api.nasa.gov` 経由では CME は動くが FLR は 404。デモで使う前に、使う種類（GST, FLR, SEP など）を個別に確認してください。
- **TechTransfer**: `api.nasa.gov` のパスは 302 で `technology.nasa.gov/api/` にリダイレクトされます。直接 `https://technology.nasa.gov/api/api/patent/{keyword}` を呼んでください。
