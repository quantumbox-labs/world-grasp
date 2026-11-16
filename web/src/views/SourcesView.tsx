// 「データと根拠」: the sources and formulas behind the WALKBACK numbers, moved off the main panel
// (texts unchanged). Every number in them still comes from the Rust core (its constants).
import { useEffect, useMemo, useState } from 'react';
import type { Core } from '../core';
import { loadWalkData, type WalkData } from '../walk/data';
import { MAX_SLOPE } from '../walk/plan';
import { useT } from '../i18n';

export function SourcesView({ core }: { core: Core }) {
  const t = useT();
  const [data, setData] = useState<WalkData | null>(null);
  useEffect(() => { loadWalkData(core).then(setData).catch(() => undefined); }, [core]);
  const footModel = useMemo(() => { try { return core.footingModel(); } catch { return null; } }, [core]);
  const wxModel = useMemo(() => { try { return core.weatherModel(); } catch { return null; } }, [core]);
  const radModel = useMemo(() => { try { return core.radiationModel(); } catch { return null; } }, [core]);
  return (
    <main className="report sources-report" id="sources">
      <p className="report-eyebrow">{t('出典一覧 · アプリが実際に読み込んでいるデータ', 'Sources · the data the app actually loads')}</p>
      <h2>{t('このアプリの数字は、どのデータから来ているか', 'Where every number in this app comes from')}</h2>
      <p>{t('計算に入る数字はすべて NASA と宇宙機関のデータから来ています。背景の地図は見た目のためだけで、計算には入りません。岩の成分だけは論文の値です。',
        'Every number that goes into a calculation comes from NASA or space agency data. Background maps are for looks only and are not used in any calculation. Only the rock composition values come from published papers.')}</p>

      <div className="report-verdict">
        <div><span className="pill ok">{t('計算に使う', 'Used in calculations')}</span><b>{t('NASA・宇宙機関のデータ', 'NASA and space agency data')}</b>
          <p>{t('地形・地表・気温・放射線など。下の表の 3 つのグループ。', 'Terrain, ground, air temperature, radiation and more. The three tables below.')}</p></div>
        <div><span className="pill gray">{t('表示のみ', 'Display only')}</span><b>{t('背景の地図', 'Background maps')}</b>
          <p>{t('写真・陰影・地質図など。数字には影響しません。', 'Photos, shading and geology maps. No numbers are affected.')}</p></div>
        <div><span className="pill mid">{t('NASA以外', 'Not NASA')}</span><b>{t('論文の値', 'Values from papers')}</b>
          <p>{t('月・火星の岩の成分（酸化物の割合）と、歩く式の係数。', 'Moon and Mars rock composition (oxides), and the coefficients of the walking formulas.')}</p></div>
      </div>

      <h3>{t('地球側: 北海道ぜんぶを 1 km マスで調べる', 'Earth: all of Hokkaido on a 1 km grid')}</h3>
      <div className="report-table"><table>
        <thead><tr><th>{t('データ', 'Dataset')}</th><th>{t('何に使うか', 'What it is used for')}</th><th>{t('使い方', 'Use')}</th></tr></thead>
        <tbody>
          <tr><td><b>NASADEM</b> <small>NASA/JPL</small></td><td>{t('標高・坂・凹凸（1 km マスと、候補 14 か所の詳しい地形）', 'Elevation, slope and ruggedness (1 km cells and 14 detailed candidate sites)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>MODIS NDVI</b> <small>MOD13A1</small></td><td>{t('地面がどれだけ裸か（夏でいちばん緑の値で判定）', 'How bare the ground is (greenest value of summer)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>MODIS {t('土地被覆', 'Land Cover')}</b> <small>MCD12Q1</small></td><td>{t('裸地・雪・水の区分で、候補に入れるか外すか', 'Barren / snow / water classes to keep or drop a cell')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>NASA POWER</b></td><td>{t('いちばん寒い月・暑い月・降水量（気温の点数と「いつ行くか」）', 'Coldest and warmest months and rain (temperature score and when to go)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
        </tbody></table></div>

      <h3>{t('月・火星側: 比べる相手', 'Moon and Mars: the targets to compare with')}</h3>
      <div className="report-table"><table>
        <thead><tr><th>{t('データ', 'Dataset')}</th><th>{t('何に使うか', 'What it is used for')}</th><th>{t('使い方', 'Use')}</th></tr></thead>
        <tbody>
          <tr><td><b>Artemis III {t('候補地域', 'candidate regions')}</b> <small>NASA</small></td><td>{t('月の目標地点の位置', 'Where the lunar targets are')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>LRO Diviner</b></td><td>{t('月の目標地点の最低・最高温度（北海道と比べる）', 'Min / max temperature of each lunar target (compared with Hokkaido)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>LRO LOLA</b></td><td>{t('月の標高（計算）。坂・陰影・南極の日照と永久影は地図で表示', 'Lunar elevation (calculated). Slope, shading and south-pole light / permanent shadow are shown as maps')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span> <span className="tag disp">{t('表示', 'Display')}</span></td></tr>
          <tr><td><b>MOLA</b> · <b>TES</b></td><td>{t('火星の標高・凹凸、熱慣性とダスト被覆（地表のタイプ）', 'Mars elevation and roughness, thermal inertia and dust cover (surface type)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>JAXA {t('かぐや', 'SELENE/Kaguya')}</b></td><td>{t('月の写真と坂（LOLA と合成）の地図', 'Lunar imagery and slope maps (merged with LOLA)')}</td><td><span className="tag disp">{t('表示', 'Display')}</span></td></tr>
          <tr><td><b>{t('岩の成分（酸化物）', 'Rock composition (oxides)')}</b></td><td>{t('月・火星の目標地点の岩の化学組成', 'Rock chemistry of the Moon and Mars targets')}</td><td><span className="tag lit">{t('論文値・NASA以外', 'Papers, not NASA')}</span></td></tr>
        </tbody></table></div>

      <h3>{t('火星で歩いて帰る（Jezero クレーター）', 'Walk back on Mars (Jezero crater)')}</h3>
      <div className="report-table"><table>
        <thead><tr><th>{t('データ', 'Dataset')}</th><th>{t('何に使うか', 'What it is used for')}</th><th>{t('使い方', 'Use')}</th></tr></thead>
        <tbody>
          <tr><td><b>HiRISE DTM</b> <small>MRO · USGS</small> + <b>MOLA</b></td><td>{t('Jezero の標高（HiRISE がある所は HiRISE、ほかは MOLA）。坂を考えた経路のコスト', 'Jezero elevation (HiRISE where available, MOLA elsewhere) for slope-aware route cost')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>THEMIS {t('熱慣性', 'thermal inertia')}</b> <small>Mars Odyssey</small></td><td>{t('足元が砂か岩か（足場の係数）', 'Sand or rock under foot (footing factor)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>TES {t('ダスト被覆指数', 'Dust Cover Index')}</b> <small>MGS</small></td><td>{t('ちりに覆われた所', 'Dust-mantled ground')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>HiRISE 25 cm {t('写真', 'image')}</b> <small>MRO</small></td><td>{t('砂の波紋・岩（チェックを入れたときだけ経路に入る）', 'Sand ripples and rocks (in the route only when ticked)')} <a href="#hirise">{t('レポート', 'Report')}</a></td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>MEDA</b> <small>Mars 2020</small></td><td>{t('時刻ごとの気温と気圧（1 火星年）', 'Air temperature and pressure by hour (one Mars year)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>Perseverance {t('走行記録', 'traverse')}</b> <small>NASA/JPL</small></td><td>{t('本物のローバーの道を、提案ルートの横に表示', 'The real rover path, shown next to our route')}</td><td><span className="tag calc">{t('比較', 'Compare')}</span></td></tr>
          <tr><td><b>RAD</b> <small>Curiosity</small></td><td>{t('地表の放射線量（地球では再現できない差）', 'Surface radiation dose (the gap Earth cannot reproduce)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
          <tr><td><b>{t('船外活動の記録', 'EVA records')}</b> <small>data.nasa.gov</small></td><td>{t('実際の船外活動の長さ（歩く時間の目安）', 'Real spacewalk durations (reference for walk length)')}</td><td><span className="tag calc">{t('参考', 'Reference')}</span></td></tr>
          <tr><td><b>{t('惑星地名辞典', 'Planetary Nomenclature')}</b> <small>IAU/USGS</small></td><td>{t('地名と着陸地点（行き先の候補）', 'Named places and landing sites (destinations)')}</td><td><span className="tag calc">{t('計算', 'Calc')}</span></td></tr>
        </tbody></table></div>

      <h3>{t('背景の地図（表示のみ・計算には使わない）', 'Background maps (display only, not used in calculations)')}</h3>
      <p className="tag-list">
        {['NASA GIBS (Blue Marble, ASTER GDEM)', 'Viking MDIM 2.1', 'THEMIS Day IR', 'CTX Global Mosaic', 'MOLA + HRSC (ESA/DLR)', 'Sentinel-2 cloudless (ESA/EOX)', t('国土地理院の地図', 'GSI Japan maps'), t('産総研 シームレス地質図', 'GSJ Seamless Geological Map')].map((n) => <span key={n} className="tag disp">{n}</span>)}
      </p>
      <p className="muted" id="src-colour">{t('地図の色: Jezero の HiRISE の画像は赤フィルターの単色（白黒）です。見やすさのために火星の色味を薄く着色しています（3D の写真も同じ）。全球の Viking モザイクも、少し明るく赤みを足して表示しています。数字には影響しません。', 'Map colours: the Jezero HiRISE images are single-colour (red filter, greyscale). A light Mars tint is added for readability (as in the 3D photo). The Viking globe mosaic is shown a little brighter and redder. No numbers are affected.')}</p>

      <h3>{t('地球では再現できないもの', 'What Earth cannot match')}</h3>
      <p>{t('重力（月 0.17 g・火星 0.38 g）、真空・薄い大気、宇宙の放射線。隠さずに「差」として表示しています。', 'Gravity (Moon 0.17 g, Mars 0.38 g), vacuum or thin air, and space radiation. The app shows these as gaps instead of hiding them.')}</p>

      <h3>{t('歩く計算の式と係数', 'Formulas and coefficients of the walk')}</h3>
      <div className="report-formulas">
          {footModel && (
            <p className="muted" id="ev-footing">{t(
              `足場: Mars Odyssey THEMIS の熱慣性（100 m）と MGS TES のダスト被覆指数から、歩く時間（＝酸素・冷却水）を何倍にするかを決めています。熱慣性 ${footModel.ti_loose} 以下は細かい砂・ちり（Presley & Christensen 1997）で ×${footModel.eta_loose}（砂の上を歩くと平らな硬い地面の 1.6〜2.5 倍のエネルギー、Lejeune ほか 1998 の下限）、${footModel.ti_firm} 以上は岩・固まった地面（Putzig & Mellon 2007）で ×${footModel.eta_firm}（未舗装路の地形係数、Soule & Goldman 1972）。その間は熱慣性の対数で直線的に補間（目安）。ダスト被覆指数 ${footModel.dci_dusty} 未満のちりに覆われた所は ×${footModel.dust_extra}（目安）。岩の多さは熱慣性に含まれます（1 km より細かい岩の量の地図はないため）。`,
              `Footing: from Mars Odyssey THEMIS thermal inertia (100 m) and the MGS TES dust cover index, a factor on walking time (and so O₂ and water). Thermal inertia ≤ ${footModel.ti_loose}: fine sand and dust (Presley & Christensen 1997), ×${footModel.eta_loose} (walking on sand costs 1.6–2.5× the energy of firm ground, Lejeune et al. 1998, low end); ≥ ${footModel.ti_firm}: rock or cemented ground (Putzig & Mellon 2007), ×${footModel.eta_firm} (dirt-road terrain coefficient, Soule & Goldman 1972). In between: linear in log thermal inertia (estimate). Dust cover index < ${footModel.dci_dusty}: ×${footModel.dust_extra} (estimate). Rock abundance is part of thermal inertia (no rock map finer than 1 km exists).`)}</p>
          )}

          {wxModel && data?.weather && (
            <p className="muted" id="ev-weather">{t(
              `気温: Perseverance の MEDA が Jezero で測った気温と気圧（NASA PDS、1 火星年に散らばる ${data.weather.sols.length} sol を地方時ごとに平均、表 mars_weather）。冷却水は「体が出す熱 − 宇宙服から外へ逃げる熱」を捨てるのに使うので、寒いほど少なくて済みます。体の熱 ${wxModel.metabolic_w} W（火星船外活動の平均代謝、NASA NTRS 20110010198）、逃げる熱 ${wxModel.leak_w_per_k} W/K ×（皮膚 ${wxModel.t_skin_k} K − 気温）、基準は試験室の ${wxModel.t_ref_k} K（この3つは目安）。出発から酸素の時間分の気温の平均で冷却水の時間を補正します。気圧は表示のみ。`,
              `Air: temperature and pressure Perseverance MEDA measured at Jezero (NASA PDS; ${data.weather.sols.length} sols over one Mars year averaged by local time; table mars_weather). Cooling water carries away body heat minus what leaks out through the suit, so colder air needs less. Body heat ${wxModel.metabolic_w} W (average Mars EVA metabolic rate, NASA NTRS 20110010198), leak ${wxModel.leak_w_per_k} W/K × (skin ${wxModel.t_skin_k} K − air), reference ${wxModel.t_ref_k} K lab (these three are estimates). The water time is corrected by the mean over the oxygen time from departure. Pressure is shown only.`)}</p>
          )}

          <p className="muted" id="ev-slope-limit">{t(`坂の上限 ${MAX_SLOPE}°（上りも下りも）: 火星の砂丘で、ゆるい砂が崩れ落ちる角度（動的な安息角）が Gale・Herschel で 30〜31°、Nili Patera で 33〜34° と HiRISE の地形から測られています（Atwood-Stone & McEwen 2013, GRL）。低い方の 30° を上限にし、これより急なマスは帰れる範囲・経路探索で通れない扱い、手で引いたルートは「通れない坂がある」と判定します。参考: Apollo 15 では宇宙飛行士が 15〜20° と見積もった斜面で作業しました（LROC）。下り専用の値は見つからなかったので同じ値です。`, `Slope limit ${MAX_SLOPE}° (up and down): loose sand on Martian dunes avalanches at 30–31° (Gale, Herschel) to 33–34° (Nili Patera), measured from HiRISE terrain (Atwood-Stone & McEwen 2013, GRL). The lower 30° is used: steeper cells are not walkable in the walk-home area and the planner, and a drawn route with one is impassable. For reference, Apollo 15 crews worked on slopes they estimated at 15–20° (LROC). No separate downhill value was found.`)}</p>

          {radModel && (
            <p className="muted" id="ev-radiation">{t(
              `放射線: Curiosity の RAD が火星の地表で測った線量当量 ${radModel.dose_eq_msv_per_day} ± ${radModel.dose_eq_sigma} mSv/日（吸収線量 ${radModel.absorbed_mgy_per_day} mGy/日、Hassler ほか 2014 Science）で、歩く時間 × この値。上限は NASA-STD-3001 の生涯 ${radModel.career_limit_msv} mSv（太陽フレア 1 回あたり ${radModel.spe_limit_msv} mSv）。この値では 1 回の船外活動で放射線が先に尽きることはありません（酸素・冷却水が先）。Gale は Jezero より約 2 km 低いので、Jezero の値は目安。太陽フレア（SPE）は数時間で桁違いに増えるので、そのときはすぐ基地へ戻る、が対策です。`,
              `Radiation: Curiosity RAD measured ${radModel.dose_eq_msv_per_day} ± ${radModel.dose_eq_sigma} mSv/day dose equivalent on the surface (${radModel.absorbed_mgy_per_day} mGy/day absorbed; Hassler et al. 2014, Science); walking time × this rate. Limits from NASA-STD-3001: ${radModel.career_limit_msv} mSv per career (${radModel.spe_limit_msv} mSv per solar particle event). At this rate radiation never runs out first on one EVA (O₂ or water does). Gale is ~2 km lower than Jezero, so the value is an estimate there. A solar particle event can raise it by orders of magnitude for hours: the answer is to head back at once.`)}</p>
          )}

          <p className="muted">{t('急いで歩くと冷却水は酸素の約1.15倍の速さで減ります（NASA の歩行帰還試験、Gernhardt 2010）。帰着時に30分・2割を残すのは Apollo 以来の慣例です。', 'Walking hard uses cooling water about 1.15× as fast as oxygen (NASA walkback tests, Gernhardt 2010). Arriving with 30 min / 20% left is Apollo-era practice.')}</p>

            <p className="muted" id="ev-weights">{t('「最短距離」は距離だけで探した経路（帰れる範囲・歩ける坂の中で）。「安全重視」の各歩のコスト ＝ 歩く時間 ×（1 ＋ 安全優先 ×（坂 ×（坂/10°）² ＋ 足場 ×（η−1）/0.5 ＋ そのマスまで行って戻るのに使う割合））。歩く時間は判定と同じ計算（坂・足場・出発時刻の冷却水）。「足場の悪い区間」は η が かたい地面と砂の中間（1.35）以上の区間の割合。重みは好みの指定で、物理の係数ではありません。', 'Weights: the cost of each step = walking time × (speed + slope × (slope/10°)² + footing × (η−1)/0.5 + margin × the share of the budget used going there and back). Walking time is the verdict\'s own calculation (slope, footing, departure-time water). "Poor footing" = share of the route with η at or above the midpoint of firm and loose (1.35). Weights are preferences, not physical coefficients.')}</p>

                <p className="muted">{t('冷却水の倍率は出発時刻の気温（Perseverance MEDA）で決まり、時間ではなく冷却水の予算に効きます。', 'The water factor comes from the air temperature at the departure time (Perseverance MEDA); it changes the cooling-water budget, not the time.')}</p>

        <p id="src-terrain" className="muted">{t('データ: Mars 2020 Perseverance 走行記録（NASA/JPL MMGIS）、MRO HiRISE 画像と地形（NASA/UArizona, USGS）、MGS MOLA 地形、Mars Odyssey THEMIS、MRO CTX、data.nasa.gov 船外活動記録、NASADEM（北海道の地形、NASA/JPL）。北海道の航空写真は国土地理院（表示のみ）。', 'Data: Mars 2020 Perseverance traverse (NASA/JPL MMGIS), MRO HiRISE images and terrain (NASA/UArizona, USGS), MGS MOLA, Mars Odyssey THEMIS, MRO CTX, data.nasa.gov EVA records, NASADEM (Hokkaido terrain, NASA/JPL). Hokkaido aerial photos: GSI Japan (display only).')}{data?.dem?.src ? ` ${t('地形グリッド', 'Terrain grid')}: ${data.dem.src}` : ''}</p>
      </div>
      <p className="muted"><a href="#walk">{t('← 火星で歩いて帰る に戻る', '← Back to Walk back on Mars')}</a></p>
    </main>
  );
}
