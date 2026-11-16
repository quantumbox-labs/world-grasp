
export async function piAcquireSessionLock(name) {
  if (!navigator.locks) throw new Error('Web Locks unavailable');
  let signal;
  const acquired = new Promise(resolve => { signal = resolve; });
  let release;
  const finished = navigator.locks.request(name, { ifAvailable: true }, async lock => {
    if (!lock) { signal(false); return; }
    const held = new Promise(resolve => { release = resolve; });
    signal(true);
    await held;
  }).catch(() => signal(false));
  if (!await acquired) throw new Error('session already open');
  return () => { release(); return finished; };
}
