# world-grasp 変更記録 (原典 nasa-hackason に対する差分)

原典 `course-inc/nasa-hackason` (main @63ffa33) のツリーに、状況把握画面 (#grasp) を
加算的に追加した。エンジン (crates/) とデータ (data/, web/public/data/) は無変更。

## 追加ファイル

| ファイル | 内容 |
|---|---|
| `web/src/grasp/units.ts` | ユニットのデータモデル (GraspUnit / UnitKind / UnitStatus) と、原典エンジンで判定する計算層。徒歩ユニットは `walk/plan.ts` の denseRoute + evaluate (火星) / `core.evaluateRoute` (地球)、ローバーは `plan.ts` の roverWalkback、帰還可能エリアは reach / reachFrom。シナリオ定義 (火星3ユニット・地球2ユニット) もここ |
| `web/src/grasp/grasp.css` | #grasp 画面専用のスタイル (grasp- 接頭辞)。既存 styles.css の変数・部品を前提 |
| `web/src/views/GraspView.tsx` | 状況把握画面: 火星/地球タブ、アラート一覧、ユニット一覧、選択ユニットの詳細 (判定・進捗スライダ・引き返し地点・帰還可能エリア)、地図 (PlanetMap 再利用) |

## 変更した原典ファイル

| ファイル | 変更 |
|---|---|
| `web/src/App.tsx` | `GraspView` の import、View 型に `'grasp'` 追加、parseHash に `#grasp` 分岐、ナビに「🛰 状況把握」リンク、view-host の div を1つ追加。それ以外は無変更 |

## 地球モード v2 (2026-11-17 追加)

#grasp の地球タブのみ拡張 (火星タブは無変更)。詳細は `../EARTH_V2.md`。

| ファイル | 変更 |
|---|---|
| `web/src/views/GraspView.tsx` | サイトセレクタ (index.json 全14サイト、切替でグリッド再登録・基地移動・ユニットリセット)、地図クリックでユニット追加、行動可能時間の編集、ユニット削除、EONET パネルを追加 |
| `web/src/grasp/units.ts` | `earthPresetUnits` (サイト別初期配置) と `customEarthUnit` (クリック追加用) を追加 |
| `web/src/grasp/EonetPanel.tsx` | 新規: NASA EONET イベント一覧 (ライブ/サンプル表示付き) |
| `web/src/grasp/eonet.ts` | 新規: EONET v3 取得とパース、失敗時は同梱サンプルへフォールバック |
| `web/src/grasp/eonet-sample.json` | 新規: API と同じ形の同梱サンプル |
| `web/src/grasp/grasp.css` | サイトバー / EONET パネル / 削除ボタンのスタイル追加 |
| `web/tsconfig.json` | `resolveJsonModule: true` を追加 (サンプル JSON の import 用) |

## 設計上の注意

- 判定の数値はすべて原典エンジン (analog-core) の出力。距離×係数のような独自の近似式は使っていない。
- ローバーは「ローバー自体の走行可否」ではなく、原典 #11 の B モードと同じ
  「ここで故障したら乗員が歩いて基地へ帰れるか」 (roverWalkback の予算比 ratio) で判定する。
  基地は原典どおり LANDING 固定。
- 地球モードは原典同梱の北海道アナログサイト DEM (NASADEM) のうち登別グリッドを流用した
  実データ。足場 (THEMIS/TES η) と気温 (MEDA) の補正は Jezero 専用データなので地球では
  未適用で、スーツの O₂ 枠を「行動可能時間」として同じ effort-hours 予算で数える
  (水は制限にならないよう大きな値)。この扱いは画面内にも明記した。
- 車両ユニット種別は型 (UnitKind) にのみ用意し、シナリオは同梱していない
  (エンジンが徒歩前提のため、車両の判定を偽装しない)。
