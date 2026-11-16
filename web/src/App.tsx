// Hash router.
//   #walk[/world/lat/lon/zoom]    → WALKBACK route planner (default; #mars kept as an alias)
//   #target[/body/test/site]      → Explore all of Hokkaido (#10, target-first)
//   #analogs                      → Hokkaido site → Moon/Mars (#10, site-first)
//   #hirise                       → Report: sand ripples and rocks judged from HiRISE images
//   #suit                         → Astronaut view: way-home navigator (reads the WALKBACK route)
import { useEffect, useState } from 'react';
import { loadCore, type Core, type World } from './core';
import { AnalogsView } from './views/AnalogsView';
import { TargetView, type TargetParams } from './views/TargetView';
import { WalkView, type WalkParams } from './views/WalkView';
import { SourcesView } from './views/SourcesView';
import { SuitView } from './views/SuitView';
import { HiriseReportView } from './views/HiriseReportView';
import { GraspView } from './views/GraspView';
import { setLang, useLang, useT } from './i18n';
import { Splash, wantSplash } from './Splash';
import { loadWalkData } from './walk/data';
import { SettingsDialog } from './SettingsDialog';

type View = 'target' | 'analogs' | 'walk' | 'sources' | 'suit' | 'hirise' | 'grasp';

function parseHash(): { view: View; params: WalkParams; target: TargetParams } {
  const [name, world, lat, lon, z] = location.hash.replace(/^#/, '').split('/');
  if (name === 'analogs') return { view: 'analogs', params: {}, target: {} };
  if (name === 'sources') return { view: 'sources', params: {}, target: {} };
  if (name === 'hirise') return { view: 'hirise', params: {}, target: {} };
  if (name === 'suit') return { view: 'suit', params: {}, target: {} };
  if (name === 'grasp') return { view: 'grasp', params: {}, target: {} };
  if (name === 'walk' || name === 'mars' || name === '') {
    const w = (['earth', 'moon', 'mars'].includes(world) ? world : name === 'mars' ? 'mars' : undefined) as World | undefined;
    const num = (s?: string) => (s && Number.isFinite(+s) ? +s : undefined);
    return { view: 'walk', params: { world: w, lat: num(lat), lon: num(lon), z: num(z) }, target: {} };
  }
  return { view: 'target', params: {}, target: name === 'target' ? { body: world, test: lat, ...(lon === 'scan' ? { mode: 'scan' } : { site: lon }) } : {} };
}

/** "Other views ▾": the remaining screens in a small menu (closes on choice, outside click, Esc). */
function OtherViews({ current }: { current: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const items: [string, string, string][] = [
    ['hirise', t('レポート: 岩と波紋', 'Report: rocks & ripples'), '#hirise'],
    ['target', t('北海道全域の探索', 'Explore all of Hokkaido'), '#target'],
    ['analogs', t('地点 → 月・火星', 'Site → Moon/Mars'), '#analogs'],
    ['sources', t('データと根拠', 'Data and sources'), '#sources'],
  ];
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.('.other-views')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  const here = items.find(([v]) => v === current);
  return (
    <div className="other-views">
      <button className={here ? 'on' : ''} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {here ? here[1] : t('ほかの画面', 'Other views')} ▾
      </button>
      {open && (
        <div className="other-views-menu" role="menu">
          {items.map(([v, label, href]) => (
            <a key={v} role="menuitem" href={href} className={v === current ? 'on' : ''} onClick={() => setOpen(false)}>{label}</a>
          ))}
        </div>
      )}
    </div>
  );
}

export function App() {
  const t = useT();
  const lang = useLang();
  const [core, setCore] = useState<Core | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState(parseHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([parseHash().view]));

  useEffect(() => { loadCore().then(setCore, (e) => setError(String(e))); }, []);
  // Splash while the Rust core and the Jezero data load (steps: core, data).
  const [splash, setSplash] = useState(wantSplash);
  const [dataReady, setDataReady] = useState(false);
  useEffect(() => {
    if (!core) return;
    loadWalkData(core).then(() => setDataReady(true), () => setDataReady(true));
  }, [core]);
  // Scan tools for agents, the console and e2e (#11 registers them in its own harness).
  useEffect(() => {
    if (!core) return;
    const tools = () => import('./agent/explore').then((m) => ({ explore: m.makeExploreTool(core), view: m.makeScanViewTool(core) }));
    (window as unknown as { analogScan: unknown }).analogScan = {
      explore: (args?: object) => tools().then((t) => t.explore.run(args ?? {})),
      view: (args?: object) => tools().then((t) => t.view.run(args ?? {})),
      tools: () => tools().then((t) => [t.explore, t.view]),
    };
  }, [core]);
  useEffect(() => {
    const on = () => {
      const r = parseHash();
      setRoute(r);
      setVisited((v) => (v.has(r.view) ? v : new Set(v).add(r.view)));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <>
      {splash && <Splash ready={(!!core || !!error) && (dataReady || !!error)} steps={[(core ? 1 : 0) + (dataReady ? 1 : 0), 2]} onDone={() => setSplash(false)} />}
      <header>
        <h1>WALKBACK <small>Hokkaido × Mars</small></h1>
        <nav aria-label={t('画面', 'Views')}>
          <a href="#walk" className={route.view === 'walk' ? 'on' : ''}>🥾 {t('火星で歩いて帰る', 'Walk back on Mars')}</a>
          <a href="#suit" className={route.view === 'suit' ? 'on' : ''}>{t('宇宙飛行士ビュー', 'Astronaut view')}</a>
          <a href="#grasp" className={route.view === 'grasp' ? 'on' : ''}>🛰 {t('状況把握', 'Grasp')}</a>
          <OtherViews current={route.view} />
        </nav>
        <div className="lang-switch" role="group" aria-label={t('言語', 'Language')}>
          <button className={lang === 'ja' ? 'on' : ''} aria-pressed={lang === 'ja'} onClick={() => setLang('ja')}>日本語</button>
          <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
        </div>
        <button className="settings-btn" onClick={() => setSettingsOpen(true)} aria-label={t('設定', 'Settings')}>⚙ {t('設定', 'Settings')}</button>
      </header>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {error && <p className="warn" style={{ padding: 16 }}>{t('計算の部分を読み込めませんでした。新しいブラウザ（Chrome・Edge・Safari・Firefox の最新版）で開き直してください。', 'Could not load the calculation part. Reopen the page in a current browser (latest Chrome, Edge, Safari or Firefox).')}<br /><small>{error}</small></p>}
      {!core && !error && <p className="muted boot">{t('計算エンジンと NASA データを読み込み中…', 'Loading the calculation engine and NASA data…')}</p>}
      {core && (
        <>
          {/* Views stay mounted once opened so map state survives tab switches. */}
          {visited.has('target') && <div className="view-host" hidden={route.view !== 'target'}><TargetView core={core} params={route.target} /></div>}
          {visited.has('analogs') && <div className="view-host" hidden={route.view !== 'analogs'}><AnalogsView core={core} /></div>}
          {(visited.has('walk') || visited.has('suit')) && <div className="view-host" hidden={route.view !== 'walk'}><WalkView core={core} params={route.params} /></div>}
          {visited.has('suit') && <div className="view-host" hidden={route.view !== 'suit'}><SuitView core={core} /></div>}
          {visited.has('grasp') && <div className="view-host" hidden={route.view !== 'grasp'}><GraspView core={core} /></div>}
          {route.view === 'sources' && <div className="view-host"><SourcesView core={core} /></div>}
          {route.view === 'hirise' && <div className="view-host"><HiriseReportView /></div>}
        </>
      )}
      {/* Credits for what the current screen shows: Mars only on the Mars screens. */}
      {route.view === 'walk' || route.view === 'suit' || route.view === 'sources' || route.view === 'hirise'
        ? <footer>Data: NASA Solar System Treks (MRO HiRISE, MGS MOLA/TES, Viking MDIM 2.1, Mars Odyssey THEMIS), MRO CTX (Caltech), ESA Mars Express HRSC, NASA/JPL Mars 2020 (traverse, MEDA), Curiosity RAD, USGS Astrogeology, IAU/USGS Gazetteer, data.nasa.gov</footer>
        : <footer>Data: NASA GIBS, NASA Solar System Treks (LRO LOLA/WAC/Diviner, MGS MOLA/TES, Viking, Mars Odyssey THEMIS), JAXA SELENE (Kaguya), ESA Mars Express HRSC, MRO CTX (Caltech), ESA Sentinel-2 cloudless (EOX), 国土地理院, 産総研 地質調査総合センター</footer>}
    </>
  );
}
