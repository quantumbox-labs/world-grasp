import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Dev only: serve /api/agent with the same relay the deployment runs (public/_worker.js), reading
// TACHYON_API_KEY (e.g. TACHYON_API_KEY=$(tachyon auth token | cat)) or ANTHROPIC_API_KEY from the shell. Without either, the panel uses rules.
const agentRelay = (): Plugin => ({
  name: 'agent-relay',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/agent', async (req, res) => {
      // @ts-expect-error plain JS worker, no types
      const worker = (await import('./public/_worker.js')).default;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const url = `http://${req.headers.host}/api/agent`;
      const r: Response = await worker.fetch(
        new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }),
        { TACHYON_API_KEY: process.env.TACHYON_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN },
      );
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await r.arrayBuffer()));
    });
  },
});

// __DUCKDB_LOCAL__: bundle the DuckDB wasm (Tauri sets TAURI_ENV_PLATFORM in beforeBuildCommand;
// e2e sets DUCKDB_LOCAL=1 to run offline). The web build loads it from jsDelivr instead (db.ts).
const duckdbLocal = !!process.env.TAURI_ENV_PLATFORM || process.env.DUCKDB_LOCAL === '1';

// `base: './'` makes the build work from any path (GitHub Pages subfolder, Tauri, file server).
export default defineConfig({
  plugins: [react(), agentRelay()],
  base: './',
  define: { __DUCKDB_LOCAL__: JSON.stringify(duckdbLocal) },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
});
