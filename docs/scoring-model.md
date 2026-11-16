# HOKKAIDO ANALOG FINDER — スコアリングモデル（Drive 調査の抽出まとめ）

作成: 2026-11-14 / チーム: HOKKAIDO ANALOG FINDER / 課題: #10 Earth Analogs
出典（Google Drive フォルダ `16-3exsG-syT1CKZ2cLRpzxpwZLsjRUbU`、読み取りのみ）:
- `15_論文リサーチ_Earth Analogs特化.md`（64本・DOI 全件検証済み）… 以下 **[15]**
- `12_追加リサーチ第3弾_統合と決定ブリーフv2.md` … **[12]**
- `13_論文リサーチ第2弾_出典と信ぴょう性スコア.md`（Preston / Hughes / Rahill の DOI 確認用に参照）… **[13]**
- `06_課題06-10_公式データ.md` … **[06]**
- `11_本番準備_統合ハブ_2026-11-12` … **[11hub]**

> 凡例: 論文スコア S/A/B は [15][13] の信ぴょう性ランク（S=一流誌かつ被引用100以上、A=査読誌・主要会議、B=注意して使う）。
> 「⚠推論」は論文ではなくチームの当てはめ・設計値。「⚠Drive未記載」は本ドキュメントで補った値で、使う前に確認が必要。

---

## 0. トップサマリ

| 項目 | 内容 |
|---|---|
| コンセプト | 火星・月の探査ターゲットを1つ選ぶと、北海道で最も近いアナログ地点と「いつ行けば試験できるか」を、根拠付きのスコアで示す比較マップ [12 §7.2] |
| 5次元 | **Topography / Geology / Temperature / Lighting / Regolith**（ShadowAstra Atlas の5軸を採用）[12 §2.1] |
| 統合式 | `Match = 0.40 × S_factors + 0.60 × S_learned`。**当日は S_factors（5軸の重み付き和）だけを実装**し、S_learned（XGBoost+LightGBM+LR）は先行研究の手法として引用するにとどめる [12] |
| タスク別重み | 9種: base / traverse / isru / ice / caves / astrobio / impact / polar / landing。例: ice → temperature 0.40、landing → topography 0.50 [12]。9種の全重み表は Drive に無い（ShadowAstra `TASK_WEIGHTS` を参照する必要あり） |
| Gap の扱い | 宇宙放射線と低重力（0.38G / 0.16G）は地球で再現できないため**スコアに入れず**、警告バッジとして表示する [12] |
| 「主観に見える」への対策 | ①全軸の出典と数値を画面に出す ②重みをスライダーで動かせるようにする ③Gap バッジ [12 §7.1] |
| MVP のペア（4組） | 大雪山↔Arcadia Planitia / 然別風穴↔Marius Hills Pit / 登別地獄谷↔Mawrth Vallis / 有珠山・昭和新山↔Compton-Belkovich [12 §2.2] |
| 公式データパック | **Drive には無い**。11/13 公開予定の時点で調査が止まっている。公式サマリーは「NASA ほか宇宙機関の Earth / Moon / Mars オープンデータ」とだけ書いている [06] |

---

## 1. 5次元の定義・定量化・根拠論文

### 1.1 一覧（計算方法は [12 §7.2]）

| # | 次元 | 定義 | 定量化（計算方法） | 閾値・重み |
|---|---|---|---|---|
| 1 | **Topography（地形）** | 傾斜・起伏・岩塊・縦穴の形が天体側とどれだけ似ているか | 傾斜角ヒストグラムの **Wasserstein 距離**＋比高差 | EVA 制約は傾斜 >15°（月南極）。岩石被覆率 8%（火星の最頻値）〜20%（着陸の許容上限）。タスク landing では重み 0.50 |
| 2 | **Geology（地質）** | 岩石の化学組成と変質鉱物の一致度 | 岩石主成分（SiO₂, FeO, TiO₂, Al₂O₃, MgO, CaO）の**コサイン類似度** | 衛星 TIR による SiO₂ 推定の誤差は 2〜3 wt%（60〜70 wt% の範囲） |
| 3 | **Temperature（温度・寒冷度）** | 夜間最低地温・日較差・乾燥寒冷度（永久凍土の有無を含む） | 3変数の**マハラノビス距離** | タスク ice では重み 0.40。南極ドライバレーの区分（夏季平均 −5℃ / −10℃、融解日数 0日）が基準になる |
| 4 | **Lighting（日照）** | 月別の太陽仰角と日照時間の一致度（極域の低照度・長い影） | 月別太陽仰角・日照時間の**コサイン一致度** | 月南極の電力条件は日照率 >50% |
| 5 | **Regolith（表土）** | 植生の無い未固結の砂礫・火山灰で、乾いているかどうか | `0.6 × i_bare + 0.4 × i_dry`（i_bare＝低植生率（NDVI）、i_dry＝乾燥度） | FoM（Figure of Merit）で 0〜1 に正規化する考え方。見かけ熱慣性（ATI）<2.3×10⁻² ならテフラに覆われた地表 |
| — | 統合 | 5軸の重み付き和 → 0〜100 | `S_factors = Σ w_task,i × s_i`（s_i は 0〜1 に正規化） | 重みはタスク9種から選び、スライダーで調整する |

### 1.2 次元ごとの根拠論文

**全体の枠組み（統合・忠実度の考え方）**

| 論文 | 年 | DOI | ランク | 使い方 |
|---|---|---|---|---|
| Preston & Dartnell, Planetary habitability: lessons learned from terrestrial analogues | 2014 | 10.1017/s1473550413000396 | S | アナログ忠実度（fidelity）の評価軸。4大忠実度の枠組み [12][13] |
| Hughes et al., BASALT A: Basaltic Terrains in Idaho and Hawai'i as Planetary Analogues | 2018 | 10.1089/ast.2018.1847 | A | 玄武岩アナログの選定基準（「Rock Alteration Index」は論文の指標ではない点に注意）[13] |
| Rahill et al., Increasing fidelity in lunar and martian analogs… | 2025 | 10.3389/frspt.2025.1505823 | A | 忠実度の3層分類 [13] |
| Gruber et al., AMADEE-18 and the Analog Mission Performance Metrics Analysis | 2020 | 10.1089/ast.2019.2034 | A | 「Site Representativeness（地形・地質・気候・土壌の一致度）」を重み付きで 0〜100% に換算。**5軸の重み付き和を 0〜100 で示す方式の直接の前例** [15] |
| Hock et al., Life in the Atacama: A scoring system for habitability… | 2007 | 10.1029/2006jg000321 | A | 多変量スコア（DSS）。5因子でハビタビリティの分散の 96.2% を説明 [15] |
| Metzger et al., Measuring the fidelity of asteroid regolith and cobble simulants | 2018 | 10.1016/j.icarus.2018.12.019 | A | 項目ごとに FoM を出して重み付きで合算する方式。統合式の正当化に使える [15] |

**1) Topography**

| 論文 | 年 | DOI | ランク | 使える数値 |
|---|---|---|---|---|
| Golombek & Rapp, Size-frequency distributions of rocks on Mars and Earth analog sites | 1997 | 10.1029/96je03319 | S | 火星の最頻岩石被覆率 8%（このとき高さ 20 cm 以上の岩が地表の約1%）。0.5 m 岩に耐える機体は被覆率 20% まで着陸できる |
| Gawronska et al., Geologic context and potential EVA targets at the lunar south pole | 2020 | 10.1016/j.asr.2020.05.035 | A | 月南極では局所傾斜 **>15°** が頻繁に出て EVA を大きく制約する。日照率 >50% の高所 |
| Sauro et al., Lava tubes on Earth, Moon and Mars | 2020 | 10.1016/j.earscirev.2020.103288 | S | 溶岩チューブの体積は火星で地球の 10〜100倍、月で 100〜1000倍（caves タスク） |
| Haruyama et al., Possible lunar lava tube skylight observed by SELENE cameras | 2009 | 10.1029/2009gl040635 | S | Marius Hills Hole の直径 65 m、深さ 80〜88 m、天井の溶岩厚 20〜25 m |
| Ishikawa, Kamiya & Iwahana, Morphometric Analysis of Patterned Grounds in the Daisetsu Mountains | 2025 | 10.1002/ppp.2265 | A | 大雪山の分級ポリゴンの長径は平坦地で 3.5 m、緩斜面で 2.9 m。**傾斜 3.5〜4.5° 以上でストライプ・ローブに変わる** |
| Hauber et al., Polygon pattern geomorphometry on Svalbard and Utopia Planitia | 2011 | 10.1016/j.geomorph.2011.07.002 | S | 火星 Utopia の多角形土: 平均直径 34.3 m / 9.8 m / 8.1 m（ユニット別） |
| Takemura & Ishigami, Traversability-Based RRT* … | 2017 | 10.20965/jrm.2017.p0838 | A | 傾斜・粗さ・段差の3つで走破コストを出す（traverse タスク） |

**2) Geology**

| 論文 | 年 | DOI | ランク | 使える数値 |
|---|---|---|---|---|
| Godoy et al., Remote Sensing Survey of Altiplano-Puna Volcanic Complex… | 2022 | 10.3390/rs14092081 | A | ASTER GED の放射率から SiO₂ を推定。誤差は 60〜70 wt% で 2〜3 wt%、50〜60 wt% で約 8 wt% |
| van der Meer et al., Potential of ESA's Sentinel-2 for geological applications | 2014 | 10.1016/j.rse.2014.03.022 | S | Fe³⁺、Fe²⁺、ゴッサン等の地質バンド比（10〜60 m） |
| van der Werff & van der Meer, Sentinel-2A MSI and Landsat 8 OLI … continuity | 2016 | 10.3390/rs8110883 | A | 大気補正済み L2A を使えば両センサのバンド比マップの相関は r ≥ 0.8 |
| Tornabene et al., orbit-based remote sensing … CanMars MSRAD | 2019 | 10.1016/j.pss.2019.04.006 | A | 衛星解析だけで地質ユニットの約 88% を正しく識別できた（衛星だけで評価してよい根拠） |
| Amils et al., Río Tinto: A Geochemical and Mineralogical Terrestrial Analogue of Mars | 2014 | 10.3390/life4030511 | A | 平均 pH 2.3、ジャロサイト（登別の pH 1.5〜2.5 と比べる）|
| Crawford et al., Remote detection of past habitability at Mars-analogue hydrothermal terrains | 2015 | 10.1016/j.icarus.2015.02.004 | A | Mawrth Vallis に似た酸性熱水変質帯（アイスランド）を分光で検出 |
| Cousins, Volcanogenic Fluvial-Lacustrine Environments in Iceland | 2015 | 10.3390/life5010568 | A | 寒冷地の火山で玄武岩ガラスがパラゴナイトに変質する（十勝岳・大雪山と比べる ⚠推論）|
| Hasegawa et al., Toya Caldera and Usu Volcano 地質概説 | 2018 | 10.5026/jgeography.127.289 | A | 有珠のデイサイトドーム（昭和新山・大有珠）。洞爺カルデラは約 11万年前 |

**3) Temperature**

| 論文 | 年 | DOI | ランク | 使える数値 |
|---|---|---|---|---|
| Marchant & Head, Antarctic dry valleys: Microclimate zonation… | 2007 | 10.1016/j.icarus.2007.06.018 | S | 3つの微気候帯。沿岸融解帯は夏季平均 −5℃・融解日数 50日超。安定高地帯は −10℃・融解日数 **0日**（火星の最良アナログ） |
| Westermann et al., 20-year record of permafrost … Bayelva | 2018 | 10.5194/essd-10-355-2018 | S | 永久凍土の平均温度 −2.8℃。年較差ゼロ深度 5.5 m |
| Ishikawa & Hirakawa, Mountain permafrost … Daisetsu Mountains | 2000 | 10.1002/1099-1530(200004/06)11:2<109::aid-ppp343>3.0.co;2-o | A | **大雪山: 標高 2,100 m 以上の北向き斜面で連続的な永久凍土**、1,750〜1,900 m で散在的。層厚は 2,050 m 以上で 6〜26 m |
| Matsumoto et al., ground ice and solifluction … Daisetsu | 2010 | 10.1002/ppp.675 | A | 凍結融解が起きるのは深さ 60 cm まで |
| Mellon et al., ice table depth … Phoenix landing site | 2008 | 10.1029/2007je003067 | A | 火星の浅部地下氷は深さ 2〜6 cm、間隙の氷は体積の 30〜50% |
| Douglas & Mellon, Sublimation of terrestrial permafrost… | 2019 | 10.1038/s41467-019-09410-8 | S | D_eff = 9.05×10⁻⁶ m²/s。氷楔の昇華は約4倍（「約5倍」は出所不明なので使わない）[13] |
| Haruyama et al., Exploration of Lunar Holes … SLIM | 2012 | 10.2322/tastj.10.pk_7 | A | 月面は −170〜+110℃。縦穴の内部は約 −20℃ でほぼ一定 |

**4) Lighting**

| 論文 | 年 | DOI | ランク | 使える数値 |
|---|---|---|---|---|
| Gawronska et al. 2020（上記） | 2020 | 10.1016/j.asr.2020.05.035 | A | 太陽光発電には日照率 >50% の地形的な高所が必要 |
| Ahrens, Fastook & Petro, Diverse lunar polar PSRs and environmental metrics | 2025 | 10.1016/j.asr.2025.07.099 | A | 永久影（PSR）を Type A/B/C に分け、傾斜の制約も入れたサイト選定指標 |
| Heemskerk et al., CHILL-ICE（EPSC 要旨） | 2020 | 10.5194/epsc2020-901 | **B** | 高緯度では夏の日照 20時間以上、冬は約4時間（極域の長い昼・極夜の模擬）。補助扱い |

> Lighting 軸は論文の裏付けが一番薄い。[12] は LRO Diviner と軌道計算を挙げているが、北海道（北緯約43°）と月極域（南緯約85°以上）の太陽仰角は大きく違う。比べるなら「冬至の低い太陽仰角と長い影」の一致度に絞るのが正直（⚠推論）。

**5) Regolith**

| 論文 | 年 | DOI | ランク | 使える数値 |
|---|---|---|---|---|
| Schrader et al., Lunar Regolith Characterization … Figure of Merit | 2009 | 10.2514/6.2009-755 | A | 粒子の種類と粒度分布を基準（Apollo 試料）と比べ、FoM を 0〜1 に正規化する |
| Sperl et al., EAC-1A: A novel large-volume lunar regolith simulant | 2020 | 10.1038/s41598-020-62312-4 | S | 富士山玄武岩の模擬土 FJS-1 と欧米の模擬土を比べたデータ（日本の火山灰を引き合いに出す根拠） |
| Liu et al., Interface Direct Shear Tests on JEZ-1 Mars Regolith Simulant | 2021 | 10.3390/app11157052 | A | Jezero の模擬土: 粘着力 <5 kPa、内部摩擦角 39.7〜40.6° |
| Goguen et al., 3D characterization … Apollo 11/14 and JSC-1A | 2024 | 10.1016/j.icarus.2024.116166 | A | 月のレゴリスでは 20 μm 未満の微粒子が総断面積の約 80% を占める |
| Clark et al., JSC-Rocknest | 2020 | 10.1016/j.icarus.2020.113936 | A | 450℃ 未満で水分 1〜3 wt% を放出（ISRU タスク） |
| Price, Ramsey & Crown, Satellite-Based Thermophysical Analysis of Volcaniclastic Deposits | 2016 | 10.3390/rs8020152 | A | ASTER の見かけ熱慣性（ATI）が **<2.3×10⁻² ならテフラに覆われた地表（粒径 4 cm 未満）**、**>3.0×10⁻² なら岩塊が露出した溶岩** |
| González-Silva et al., The Atacama Desert … as an Analog Model of Mars | 2022 | 10.3389/fspas.2021.810426 | A | 超乾燥地の年降水量 <2 mm（乾燥度 i_dry の上限の参照点）|

---

## 2. 次元ごとに必要なデータレイヤーと、天体側の参照値

### 2.1 データレイヤー（北海道側 ↔ 天体側）

| 次元 | 北海道側のレイヤー（入手方法） | 天体側のレイヤー | 前処理 |
|---|---|---|---|
| Topography | SRTM / NASADEM（OpenTopography）、国土地理院 DEM 5m/10m → 傾斜 | Mars Trek MOLA（463 m）、MOLA+HRSC（200 m）、Jezero CTX（6 m）/ HiRISE（25 cm）、Moon Trek LOLA | 地点ごとに数 km 四方を切り出し、**傾斜ヒストグラムを JSON にして同梱**（Mars Trek WMTS に全球の傾斜レイヤーは無く、DTM もタイル配信されていない [12 §3.2]）|
| Geology | 産総研シームレス地質図V2 XYZ タイル `https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png?layer=glfs`、GLiM、EMIT、ASTER GED（SiO₂）、Sentinel-2 バンド比 | 文献値の主成分組成（地点ごとに手入力）、THEMIS 昼夜赤外（100 m） | 主成分6元素のベクトルを地点ごとに JSON に持つ |
| Temperature | GIBS MODIS LST（昼・夜）、NASA POWER（MERRA-2）の月別気温、気象庁アメダス | 文献値（Marchant 2007 の区分、Mellon 2008、月面 −170〜+110℃、縦穴内 −20℃）、NASA Mars SWIM（Arcadia の地下氷）| 夜間最低・日較差・寒冷度の3変数を地点ごとに |
| Lighting | 太陽位置の計算（緯度・月別）、GIBS 積雪（MODIS） | LRO Diviner、月極域の日照率（Gawronska 2020: >50%） | 月別の太陽仰角と日照時間のベクトル |
| Regolith | GIBS MODIS NDVI / MOD44W（裸地率）、NASA POWER（乾燥度）、ASTER による ATI | 文献値（JEZ-1 の摩擦角、FoM の基準）| `0.6 × i_bare + 0.4 × i_dry` |
| 試験カレンダー | MODIS 積雪タイル＋NASA POWER の月別気温 | — | 月ごとに「試験できるかどうか」を判定 |

技術メモ [12]: GIBS と Mars/Moon Trek の WMTS は「CORS `*`・キー不要」と書かれているが、[11hub] は**実測では未確認**としている。当日、最初にタイルが取れるか確かめること。

### 2.2 天体側の参照値（論文に出てくるもの）

| 対象 | 次元 | 参照値 | 出典 |
|---|---|---|---|
| 火星（一般・着陸地点） | Topography | 最頻の岩石被覆率 8% / 着陸の許容上限 20% / 0.5 m 以上の岩は約1% | Golombek 1997 |
| 火星 Utopia Planitia | Topography | 多角形土の平均直径 34.3 m / 9.8 m / 8.1 m | Hauber 2011 |
| 火星 Phoenix（高緯度） | Temperature | 地下氷は深さ 2〜6 cm、間隙氷 30〜50% | Mellon 2008 |
| 火星 Jezero | Regolith | 粘着力 <5 kPa、摩擦角 39.7〜40.6°（模擬土 JEZ-1）| Liu 2021 |
| 火星 Gale / Rocknest | Regolith | 450℃ 未満で水 1〜3 wt% | Clark 2020 |
| 火星アナログ（超乾燥） | Regolith / 乾燥 | 年降水量 <2 mm、UV 指数 11〜20 超 | González-Silva 2022 |
| 火星アナログ（極寒） | Temperature | 夏季平均 −10℃、融解日数 0日、積雪水当量 <10 mm/年 | Marchant 2007 |
| 月南極（Artemis） | Topography / Lighting | 傾斜 >15° が多く EVA を制約、日照率 >50% の高所 | Gawronska 2020 |
| 月 Marius Hills Hole | Topography | 直径 65 m、深さ 80〜88 m、天井 20〜25 m | Haruyama 2009 |
| 月 Marius Hills（地下空洞） | Topography | 北緯 13〜15°、東経 301.85〜304.01° に数十 km 規模の空洞 | Kaku 2017（10.1002/2017gl074998, S）|
| 月の縦穴内部 | Temperature | 地表 −170〜+110℃ に対して内部は約 −20℃ | Haruyama 2012 |
| 月レゴリス | Regolith | 20 μm 未満の粒子が総断面積の約 80%、8 μm 未満が約 50% | Goguen 2024 |

---

## 3. 北海道の候補地点（ペア7組）

[12 §2.2] の7組。**Drive には座標が書かれていない**。下の座標は本ドキュメントで補った概略値（⚠Drive未記載、要確認）。⭐＝MVP の4組。

| # | 北海道の地点 | 概略座標（⚠要確認） | 天体ターゲット | 天体座標（⚠要確認） | タスク | 根拠 |
|---|---|---|---|---|---|---|
| ⭐1 | 大雪山系・白雲岳高原（山岳永久凍土・構造土） | 43.65°N, 142.90°E（標高 約2,000〜2,230 m） | 火星 Arcadia Planitia（浅部地下氷） | 約 47°N, 184°E | ice / isru | Ishikawa & Hirakawa 2000、Ishikawa 2025、Douglas & Mellon 2019 |
| ⭐2 | 然別風穴地帯（岩の隙間の冷気だまり、真夏でも 0〜2℃） | 43.27°N, 143.10°E | 月 Marius Hills Pit（溶岩縦穴） | 14.09°N, 303.23°E | caves / base | Haruyama 2009、Kaku 2017、Haruyama 2012（風穴と縦穴の対応は ⚠推論）|
| 3 | 釧路湿原・達古武沼（泥炭と火山灰の互層） | 43.10°N, 144.48°E | 火星 Jezero Crater（古三角州・粘土） | 18.38°N, 77.58°E | astrobio | SHERLOC の有機物保存との対応 [12]（⚠推論）|
| ⭐4 | 登別地獄谷・大湯沼（pH 1.5〜2.5 の強酸性熱水） | 42.50°N, 141.15°E | 火星 Mawrth Vallis（酸性熱水変質帯） | 約 22.6°N, 343.5°E | astrobio / geology | Amils 2014（Río Tinto pH 2.3）、Crawford 2015 |
| 5 | 羊蹄山の山頂火口原（低い日照角・残雪・未固結の砂礫） | 42.83°N, 140.81°E | 月 Mons Mouton（南極・低照度、Artemis / VIPER 候補） | 南緯 約84〜85°（⚠要確認）| polar / traverse | Gawronska 2020 |
| 6 | 十勝岳・白金扇状地（大正泥流） | 43.47°N, 142.64°E | 火星 Amazonis Planitia（擬似火口群） | 約 25°N, 196°E | impact / traverse | Greeley & Fagents 2001（10.1029/2000je001378, S）|
| ⭐7 | 有珠山・昭和新山（SiO₂ 約70% のデイサイトドーム） | 42.54°N, 140.86°E | 月 Compton-Belkovich（珪長質ドーム） | 約 61°N, 99.5°E | geology / isru | Hasegawa 2018、Godoy 2022 |

決め台詞の候補 [12]: 「大雪山の永久凍土から十勝岳の泥流、然別の風穴まで、半径 150 km 圏内で火星と月の環境をまとめて検証できるテストベッド」

> 注意 [13]: 北海道の地点をアナログに当てはめたのはチームの推論。**論文が北海道をアナログとして扱ったとは書かない**（大雪山の永久凍土の論文は凍土そのものの研究）。「Pires et al. 2023」は引用しない。

---

## 4. 公式の Earth Analogs リソース・データ

| 区分 | 内容 | 状態 |
|---|---|---|
| 公式タイトル | Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars | 確認済み [06] |
| レベル・分野 | Advanced / Intermediate / Beginner-Youth。Earth Science / Planets & Moons / Software / Space Exploration | [06] |
| 公式ページ | https://www.spaceappschallenge.org/2026/challenges/identify-earth-locations-that-analog-the-permanent-moon-base-locations-and-mars/ | URL が存在することだけ確認 |
| 公式サマリーが挙げるデータ | 「NASA ほか宇宙機関の Earth / Moon / Mars オープンデータ」（データセットの名前は無い）。既知のアナログ例: Atacama、Haughton Crater、Death Valley。成果物は「map, visualization, or other tool」 | [06] |
| **公式リソースパック** | **11/13 公開予定。Drive には未収録** | ❗未確認。今日まず確認する |
| 参考: 先行チーム ShadowAstra Atlas が使ったデータ（公式ではない） | NASA GIBS（Blue Marble / MODIS / ASTER GDEM）、Solar System Treks（LRO LROC・LOLA、MOLA、Viking、THEMIS）、SRTM（AWS Terrain Tiles）、Sentinel-2 cloudless | [06] |
| チームが使う予定のデータ | §2.1 の表（GIBS、Mars/Moon Trek、NASADEM、産総研地質図、国土地理院 DEM、アメダス、NASA POWER、NASA Mars SWIM `swim.psi.edu`）| [12 §7.2] |

---

## 5. 決まっていること・まだ決まっていないこと

### 5.1 MVP の範囲 [12 §7.2]

画面は次の6つ:
1. ヘッダー＋Gap 警告バッジ（「放射線・0.38G は地球で再現できません」）
2. **左右に分けた同期マップ**: 左＝北海道（GIBS / NASADEM の陰影＋産総研地質図）、右＝火星・月（Mars / Moon Trek）
3. ターゲット選択パネル（4組）
4. 5次元レーダーチャート（タスクを切り替えると重みが変わる）
5. スコア内訳パネル（値・出典・数式・重みスライダー）
6. 試験カレンダー（MODIS 積雪＋NASA POWER の月別気温）

### 5.2 技術構成 [12 §6.1, §6.3]

| 項目 | 決定 |
|---|---|
| 地図 | Leaflet（`crs: L.CRS.EPSG4326`）で左右を同期 |
| スコア計算 | ブラウザ内（Wasserstein / コサイン / マハラノビス）。重みは JSON |
| データ | タイルは外部の WMTS/WMS から直接取る。地点・ペア・重み・傾斜ヒストグラムだけ JSON で同梱 |
| ホスティング | 静的サイト（GitHub Pages など）、ビルド不要を優先 |
| オフライン対策 | Leaflet・フォント・JSON はローカルに同梱。4地点の周辺タイルだけ先に保存しておく |

### 5.3 デモと提出の予定 [12 §6.4][11hub]

| 時刻 | やること |
|---|---|
| 11/14 10:30 以降 | 課題に関わる制作を始める（[11hub]: それ以前は制作しない）|
| 土 午前 | スコア計算＋レーダー、タイル同期 → **昼までに動くデモ** |
| 土 午後 | 試験カレンダー、英語の台本 |
| 日 10:00 | 原則として機能を凍結 |
| 日 13:00 | 動画とスライドを完成（内部目標）|
| 日 14:00 | 札幌の提出締切 / 14:30 発表 |

役割: 企画＝地点の根拠表・軸と重みの定義・英語台本 / プログラマー＝Leaflet 同期・スコアエンジン・カレンダー / デザイナー＝分割マップ UI・レーダー・動画とスライド。

### 5.4 まだ決まっていないこと

1. **公式リソースパック・Full Statement・Judging / Submission Guide の現物確認**（11/13 公開予定で、Drive には反映されていない）。#10 を棄却する条件: 分光・鉱物解析が必須／対象地点が固定で北海道を扱えない／別チームが #10 を北海道テーマで登録している [12 §7.5]
2. **タスク別重み9種の数値**: Drive にあるのは ice と landing の例だけ。ShadowAstra の `TASK_WEIGHTS` から取るか、自分たちで決めて「設計値」と書く
3. **各軸の正規化方法**（距離 → 0〜1 への変換。例: `exp(-d/σ)`）と、天体側の参照ベクトルの具体値: 論文値でどこまで埋まるか
4. **Lighting 軸の妥当性**（北海道と月極域では緯度が大きく違う）
5. WMTS の CORS・投影・配信を実測で確かめること [11hub D]
6. 火星座標の扱い（planetocentric か planetographic か、東経 0〜360° か ±180° か）[11hub F]
7. 提出の形式（30秒動画か7枚以内のスライドか、英語）は旧版の暫定値。2026年版で確認する
8. GitHub は非公開のまま。デモを公開するかどうかは当日決める [11hub J]
9. 決定の経緯: [11hub] の時点では「#11 で参加予定」と書かれており、#10 への変更はチームの明示的な決定が必要とされていた。チーム名から見て #10 に決まったと考えられるが、決定の記録は Drive に無い

### 5.5 引用で気をつけること [13][15]

- B ランク（MacRobbie 2025、Watson 2000、Mangeot 2024、CHILL-ICE 2020、Riaz 2025）は単独の根拠にしない
- 原典で照合した数値は一部だけ。それ以外は「DOI は照合済み・数値はファイルの記載のまま」として扱う
- 「Pires et al. 2023」は引用しない。Douglas & Mellon の「約5倍」も使わない
