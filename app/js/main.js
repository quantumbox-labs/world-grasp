// Hash router.
//   #analogs                      → #10 Earth Analogs (default)
//   #walk[/world/lat/lon/zoom]    → #11 WALKBACK route planner (#mars kept as an alias)
// Views are created lazily on first show.
(function () {
  const views = {}, inits = { analogs: window.initAnalogs, walk: window.initWalkback };
  function parse() {
    const [name, world, lat, lon, z] = location.hash.replace(/^#/, '').split('/');
    if (name === 'walk' || name === 'mars') return { v: 'walk', params: { world: world || (name === 'mars' ? 'mars' : undefined), lat, lon, z } };
    return { v: 'analogs', params: {} };
  }
  function show() {
    const { v, params } = parse();
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('on', el.id === `view-${v}`));
    document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === v));
    if (!views[v]) views[v] = inits[v](params);
    else { views[v].invalidate(); views[v].go && views[v].go(params); }
  }
  window.addEventListener('hashchange', show);
  show();
})();
