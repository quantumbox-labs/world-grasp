# pi-rs in the browser

The question panel's "pi-rs（ブラウザ内・WebGPU）" agent (web/src/agent/pirsWeb.ts) loads the pi-rs
browser SDK from `pkg/` here (committed so the static deploy carries it). Rebuild it from quantum-box/pi-rs#238
(branch codex/browser-local-llm-demo, commit 8c006cf1) plus `pi-rs-page-tools.patch`, which adds
`BrowserSession.open_with_tools` so the page's own tools can be called by pi-rs:

    git clone https://github.com/quantum-box/pi-rs && cd pi-rs
    git fetch origin codex/browser-local-llm-demo && git checkout FETCH_HEAD
    git apply <nasa-hackason>/web/public/pirs-browser/pi-rs-page-tools.patch
    RUSTFLAGS='--cfg getrandom_backend="wasm_js"' cargo +1.89.0 build --locked --release \
      --manifest-path crates/browser-sdk/Cargo.toml --target wasm32-unknown-unknown
    wasm-bindgen --target web --out-dir <nasa-hackason>/web/public/pirs-browser/pkg \
      crates/browser-sdk/target/wasm32-unknown-unknown/release/pi_rs_browser_sdk.wasm

The agent appears when the browser has WebGPU with 16-bit float shaders; the model is picked per
device in web/src/agent/pirsWeb.ts (pickModel). The first question downloads Qwen3 4B (about 2.5 GB, a few minutes; cached
by the browser). `localStorage['walkback.pirsModel'] = '0.6b'` ('1.7b', '8b') switches model.
