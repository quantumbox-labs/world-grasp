// Tool bridge for the pi-rs bench (src-tauri agent.rs `bench`): runs the app's real agent tools in
// headless Chromium with every outside request blocked, over JSON lines on stdin/stdout.
//   in:  {"id","name","args"} | {"type":"reset"}
//   out: {"type":"tools","tools":[…]} once, then {"id","ok","output","details"} | {"type":"ready"}
//   BASE_URL=http://127.0.0.1:4188 node scripts/agent-bench/bridge.mjs
import { createRequire } from 'node:module';
import readline from 'node:readline';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4188';
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const open = async () => {
  await p.goto(`${BASE}/#walk`);
  await p.waitForSelector('.walk .verdict.ok, .walk .verdict.ng', { timeout: 30000 });
  await p.waitForFunction(() => window.__walkback?.tools().some((t) => t.name === 'explore_hokkaido'), null, { timeout: 30000 });
};
await open();
out({ type: 'tools', tools: await p.evaluate(() => window.__walkback.tools()) });
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  const m = JSON.parse(line);
  if (m.type === 'reset') { await open(); out({ type: 'ready' }); continue; }
  const r = await p.evaluate(([n, a]) => window.__walkback.callTool(n, a), [m.name, m.args]).catch((e) => ({ ok: false, result: { text: String(e) } }));
  out({ id: m.id, ok: r.ok, output: r.result.text, details: r.result });
}
await b.close();
