# WALKBACK（#11 Interplanetary Survival Guide: Martian Map）

Jezero クレーターで「基地から歩いて出て、酸素と冷却水が尽きる前に帰れるか」を判定するアプリ。`#walk` 画面。

## できること
- ルートを引くと「帰れる / 途中で引き返す」と、引き返し地点・先に尽きるもの（酸素 or 冷却水）を出す
- 基地から歩いて行って帰ってこられる範囲を地図に塗る
- ヘルメット越しに歩く再生（経過時間・残り酸素/冷却水・帰りに要る時間）
- Perseverance の実走ルートと船外活動（EVA）記録で計画を裏付ける
- 同じ長さ・同じ坂のコースを北海道（#10 の候補地）から探して練習コースとして出す

## 計算の前提
- 体力の消費 = 時間 × 坂の重さ（Tobler の歩行関数の逆数、下限 0.8）
- 冷却水は酸素の約 1.15 倍の速さで減る（Gernhardt 2010, NTRS 20100017354 の 3.1 / 2.7）
- 帰着時に 20%（最低 30 分）残す
- 地形が分からない区間は 30% 勾配の登りとして安全側に計算
- 歩ける範囲: 8近傍グリッドで行き・帰りの 2 回ダイクストラ、25° を超える坂は通らない
- 練習コース: 火星ルートの断面を北海道の標高グリッド上で始点・向き・反転を変えて当て、坂の差の RMS（距離重み付き）が最小の場所。スコア = 100·exp(−rms/6)

## データ（web/public/data、オフライン同梱）
| ファイル | 出典 |
|---|---|
| jezero_dem.json | HiRISE DTM 5 枚（USGS Astrogeology）＋ MOLA MEGDR で補完、0.0006° グリッド |
| m20_traverse.json | Perseverance 走行ルート（mars.nasa.gov MMGIS M20_traverse.json） |
| eva.csv | data.nasa.gov「Extra-vehicular Activity (EVA) - US and Russia」 |
| hokkaido/*.json | NASADEM（NASA/JPL、1 秒 ≈ 30 m、Microsoft Planetary Computer の COG。`data/raw/nasadem/*.tif` があればそれを使う）を約 83 m グリッドに双線形補間。海（≤ 0 m）と湖面（同じ標高が 1% 以上続く平面）は null にして、練習コースが水の上に乗らないようにする。`--dem gsi` で旧来の国土地理院 標高タイル版 |

作り直し: 生データを `data/raw/` に置いて `mise run walk-data`。地図タイル（オフライン用）は `mise run walk-tiles` で `web/public/tiles/` に取得（git には入れない、Tauri ビルド時に同梱）。walk-data は nasa.gov と Planetary Computer、walk-tiles は地図タイル配信元に届くネットワークが必要。
