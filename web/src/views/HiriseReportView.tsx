// Report page (#hirise): sand ripples and rocks judged from HiRISE images over Jezero, and how the
// result is used in the route search (checkbox "砂の波紋・岩を避ける" on the WALKBACK screen).
import { useT } from '../i18n';

const IMG = './report/hirise/';

export function HiriseReportView() {
  const t = useT();
  return (
    <main className="report" id="hirise-report">
      <p className="report-eyebrow">{t('レポート · Jezero 7.5 × 6.8 km · NASA HiRISE（MRO）', 'Report · Jezero 7.5 × 6.8 km · NASA HiRISE (MRO)')}</p>
      <h2>{t('HiRISE写真から、砂の波紋と岩を見分ける', 'Telling sand ripples and rocks apart in HiRISE images')}</h2>
      <p>{t('NASAのHiRISE写真（1画素 約1.3 m で使用）だけから、40 mマスごとに「砂の波紋」と「岩・凹凸が多い所」を計算で判定しました。経路探索の「砂の波紋・岩を避ける」にチェックを入れると、この結果が歩く時間と経路に入ります。外すと入りません。',
        'From NASA HiRISE images alone (used at about 1.3 m per pixel), each 40 m cell was judged as sand ripples, rocky ground or ordinary ground. Tick "Avoid sand ripples and rocks" in the route search and this result goes into the walking time and the route; untick it and it does not.')}</p>

      <div className="report-verdict">
        <div><span className="pill ok">{t('使える', 'Usable')}</span><b>{t('砂の波紋', 'Sand ripples')}</b>
          <p>{t('Séítah と Belva 火口の波紋原がはっきり出た。波紋と判定した所は THEMIS の熱慣性も低く（砂っぽい）、別の NASA データと合う。', 'The ripple fields of Séítah and Belva crater stand out. Cells judged as ripples also have low THEMIS thermal inertia (sandy), which agrees with a separate NASA dataset.')}</p></div>
        <div><span className="pill mid">{t('条件つき', 'With limits')}</span><b>{t('岩', 'Rocks')}</b>
          <p>{t('影から約3.1万個を拾った。1画素 1.3 m なので 2.5 m 未満の岩は見えない。1個ずつではなく「ゴツゴツ度」として使う。', 'About 31,000 were found from their shadows. At 1.3 m per pixel, rocks under 2.5 m are not visible, so this is used as a measure of how rocky the ground is, not as a rock count.')}</p></div>
        <div><span className="pill gray">{t('次の展開', 'Next')}</span><b>{t('25 cm の写真なら', 'With 25 cm images')}</b>
          <p>{t('HiRISE 本来の 25 cm 解像度なら 1 m 級の岩まで数えられる見込み（NASA/JPL の着陸地点選びと同じ考え方）。', 'At HiRISE’s full 25 cm resolution, rocks down to about 1 m could be counted, as NASA/JPL did when choosing landing sites.')}</p></div>
      </div>

      <h3>{t('判定結果（左: 元の写真 / 右: 判定）', 'Result (left: image / right: judged)')}</h3>
      <p className="report-key"><i className="k-rip" />{t('砂の波紋', 'sand ripples')}<i className="k-rock" />{t('岩・凹凸が多い', 'rocky ground')}</p>
      <div className="report-two">
        <figure><img src={`${IMG}original.jpg`} alt={t('Jezero の HiRISE 写真', 'HiRISE image of Jezero')} /><figcaption>{t('北が上。左上が三角州、左下が Séítah、右が火口底。', 'North up. Delta at top left, Séítah at bottom left, crater floor on the right.')}</figcaption></figure>
        <figure><img src={`${IMG}classes.jpg`} alt={t('判定結果', 'Judged result')} /><figcaption>{t('波紋 15.6%、岩・凹凸 5.6%、ふつう 78.8%（40 mマス）。', 'Ripples 15.6%, rocky 5.6%, ordinary 78.8% (40 m cells).')}</figcaption></figure>
      </div>
      <h3>{t('拡大（左: 元 / 右: 拾った岩の影 ○）', 'Close-ups (left: image / right: rock shadows found ○)')}</h3>
      <figure><img src={`${IMG}seitah.jpg`} alt="Séítah" /><figcaption>{t('Séítah の波紋原（約 650 m 四方）。縞は波紋と判定され、岩はほとんど拾っていない。Perseverance が避けて通った場所。', 'Séítah ripple field (about 650 m across). The stripes are judged as ripples and almost no rocks are picked. Perseverance drove around this area.')}</figcaption></figure>
      <figure><img src={`${IMG}floor.jpg`} alt={t('火口底', 'Crater floor')} /><figcaption>{t('火口底の東側（約 650 m 四方）。明るい凹凸の縁に ○ が集まる。', 'East crater floor (about 650 m across). The ○ marks gather on the edges of bright, rough ground.')}</figcaption></figure>

      <h3>{t('別データとの突き合わせ（THEMIS 熱慣性）', 'Check against another dataset (THEMIS thermal inertia)')}</h3>
      <div className="report-table"><table>
        <thead><tr><th>{t('判定', 'Class')}</th><th>{t('熱慣性 中央値', 'Median')}</th><th>{t('中央50%', 'Middle 50%')}</th><th>{t('読み', 'Reading')}</th></tr></thead>
        <tbody>
          <tr><td>{t('波紋', 'Ripples')}</td><td>274</td><td>224–312</td><td>{t('低い＝砂。合う', 'Low = sand. Agrees')}</td></tr>
          <tr><td>{t('ふつう', 'Ordinary')}</td><td>317</td><td>288–350</td><td>—</td></tr>
          <tr><td>{t('岩・凹凸', 'Rocky')}</td><td>299</td><td>281–322</td><td>{t('差が出ない（熱慣性は 100 m 級で粗い）', 'No clear difference (thermal inertia is ~100 m, coarse)')}</td></tr>
        </tbody></table></div>

      <h3>{t('経路探索での使い方', 'How the route search uses it')}</h3>
      <ul>
        <li>{t('チェックを入れると、各マスの歩きにくさ（足場の係数）に掛け算する: 波紋 ×1.3、岩・凹凸 ×1.15（割合に応じて）。この 2 つの係数は仮の値。', 'When ticked, each cell’s walking factor (the footing factor) is multiplied by ripples ×1.3 and rocky ×1.15, in proportion to their share. These two factors are working assumptions.')}</li>
        <li>{t('歩く時間、帰れる範囲、自動の経路探索（「足場の悪さを避ける」の重み）にすべて同じ値で入る。チェックを外すと入らない。', 'The same values go into the walking time, the walk-home area and the automatic route search (the "Avoid poor footing" weight). Untick it and they are not counted.')}</li>
        <li>{t('判定した範囲（東経 77.355〜77.481°、北緯 18.386〜18.501°）の外は数えない。', 'Outside the judged area (77.355–77.481°E, 18.386–18.501°N) nothing is counted.')}</li>
      </ul>

      <h3>{t('どう計算したか', 'How it was computed')}</h3>
      <ul>
        <li>{t('元データ: NASA Mars Trek の HiRISE 25 cm オルソモザイク（Mars 2020 着陸地点、NASA/JPL/UArizona）。アプリ同梱のズーム 15 タイル（約 1.3 m/画素）。', 'Source: the HiRISE 25 cm orthomosaic of the Mars 2020 landing site (NASA/JPL/UArizona, via NASA Mars Trek), zoom-15 tiles bundled with the app (about 1.3 m per pixel).')}</li>
        <li>{t('岩: 太陽は西から。暗い小さな塊（影）の西隣に明るい面があるものを岩とした（Golombek らの影からの岩検出の考え方を簡略化）。', 'Rocks: the sun is in the west. A small dark patch (shadow) with a bright face just west of it counts as a rock (a simplified version of the shadow method of Golombek et al.).')}</li>
        <li>{t('波紋: 5〜30 m 周期の縞を強め、向きのそろい具合 × 縞の強さで判定（JPL の地形分類の「波紋」クラスに当たる所を狙った）。', 'Ripples: stripes with a 5–30 m spacing are enhanced; how well they line up × how strong they are gives the score (aimed at the "ripples" class of JPL’s terrain classification).')}</li>
        <li>{t('AI は数字を作っていない。判定の閾値は手で決めた仮の値。', 'No AI made these numbers. The thresholds were set by hand and are provisional.')}</li>
      </ul>
      <p className="muted"><a href="#walk">{t('← 火星で歩いて帰る に戻る', '← Back to Walk back on Mars')}</a></p>
    </main>
  );
}
