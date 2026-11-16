//! analog-core: the logic of Hokkaido Analog Finder, shared by the web build (via
//! `analog-wasm`) and the desktop build (via `src-tauri`).
//!
//! - [`scoring`]: #10 Earth Analogs, 5-dimension similarity between Hokkaido and Moon/Mars sites
//! - [`scan`]: #10 whole-Hokkaido grid scored with the same formulas, top candidates and site checks
//! - [`target`]: #10 target-first ranking for a rehearsal test, and what Hokkaido cannot reproduce
//! - [`route`]: #11 WALKBACK, EVA route time and the O₂ / cooling-water return limit
//! - [`grid`]: elevation grids and the walk-home area around a base
//! - [`traverse`]: Perseverance's real drive path as evidence for a route
//! - [`eva`]: real EVA durations as a yardstick
//! - [`rehearsal`]: find the same walk (same climbs, same length) on an Earth grid
//! - [`world`]: body constants and geodesy
//! - [`data`]: bundled datasets from `data/*.json`

pub mod conditions;
pub mod data;
pub mod eva;
pub mod footing;
pub mod grid;
pub mod radiation;
pub mod rehearsal;
pub mod route;
pub mod scan;
pub mod scoring;
pub mod target;
pub mod traverse;
pub mod walk;
pub mod weather;
pub mod world;
