//! 5-dimension analog similarity (docs/scoring-model.md). Each dimension is 0–1.
//! Port of the legacy app/js/scoring.js, kept numerically identical.

use crate::data::{bodies, earth_sites, lithology_class, oxides, Body, EarthSite};
use crate::world::{noon_elevation_range, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const DIMS: [(&str, &str); 5] = [
    ("topography", "地形"),
    ("geology", "地質"),
    ("temperature", "温度"),
    ("lighting", "日照"),
    ("regolith", "表土"),
];

/// English labels for [`DIMS`], same order.
pub const DIMS_EN: [&str; 5] = ["Terrain", "Geology", "Temperature", "Sunlight", "Regolith"];

pub type Weights = BTreeMap<String, f64>;

#[derive(Debug, Clone, Serialize)]
pub struct Profile {
    pub id: &'static str,
    pub label: &'static str,
    pub en: &'static str,
    /// True for the five rehearsal tests shown in the target-first view.
    pub test: bool,
    /// Rule-of-thumb season for the test in Hokkaido (until monthly data is in).
    pub season: &'static str,
    pub season_en: &'static str,
    pub w: Weights,
}

/// Only "ice" and "landing" weights come from the Drive notes; others are team placeholders.
/// Order of `w`: topography, geology, temperature, lighting, regolith.
pub fn profiles() -> Vec<Profile> {
    let mk = |id, label, en, test, w: [f64; 5]| Profile {
        id,
        label,
        en,
        test,
        season: season(id).0,
        season_en: season(id).1,
        w: DIMS
            .iter()
            .zip(w)
            .map(|((k, _), v)| (k.to_string(), v))
            .collect(),
    };
    vec![
        mk(
            "balanced",
            "バランス",
            "Balanced",
            false,
            [0.2, 0.2, 0.2, 0.2, 0.2],
        ),
        mk(
            "landing",
            "着陸・走行",
            "Landing & roving",
            true,
            [0.50, 0.125, 0.125, 0.125, 0.125],
        ),
        mk(
            "ice",
            "氷・ISRU",
            "Ice prospecting",
            true,
            [0.15, 0.15, 0.40, 0.15, 0.15],
        ),
        mk(
            "walk",
            "歩行・船外活動",
            "Walking EVA",
            true,
            [0.40, 0.10, 0.15, 0.15, 0.20],
        ),
        mk(
            "caves",
            "縦穴・洞窟",
            "Pits & caves",
            true,
            [0.35, 0.15, 0.35, 0.05, 0.10],
        ),
        mk(
            "build",
            "建設・表土利用",
            "Construction & regolith use",
            true,
            [0.20, 0.30, 0.05, 0.05, 0.40],
        ),
        mk(
            "geology",
            "地質重視",
            "Geology-focused",
            false,
            [0.15, 0.50, 0.10, 0.05, 0.20],
        ),
    ]
}

fn season(id: &str) -> (&'static str, &'static str) {
    match id {
        "ice" => ("1〜2月（夜が一番冷える）", "Jan–Feb (coldest nights)"),
        "caves" => (
            "通年（夏に地下の氷が見せ場）",
            "All year (summer ground ice is the highlight)",
        ),
        "walk" => ("8〜9月（雪が消えた後）", "Aug–Sep (after snowmelt)"),
        "landing" | "build" => ("7〜9月（雪がない）", "Jul–Sep (snow-free)"),
        _ => ("", ""),
    }
}

pub fn profile(id: &str) -> Profile {
    profiles()
        .into_iter()
        .find(|p| p.id == id)
        .unwrap_or_else(|| profiles().remove(0))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DimScore {
    pub key: String,
    pub label: String,
    pub s: f64,
    pub why: String,
    #[serde(default)]
    pub label_en: String,
    #[serde(default)]
    pub why_en: String,
    pub formula: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairScore {
    pub body_id: String,
    pub total: f64,
    pub raw: f64,
    pub excluded: Option<String>,
    pub dims: Vec<DimScore>,
}

const EXCLUDED_COVER: [&str; 3] = ["Urban and Built-up Lands", "Croplands", "Water Bodies"];

/// Screening before scoring: an analog must be a natural surface (MODIS IGBP class at the site).
pub fn screen_out(e: &EarthSite) -> Option<String> {
    let lc = e.landcover_center.as_deref()?;
    EXCLUDED_COVER
        .contains(&lc)
        .then(|| format!("人工・農地・水面のため除外（MODIS 土地被覆: {lc}）"))
}

fn r1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}
fn clamp01(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}

fn dim(key: &str, s: f64, why: String, why_en: String, formula: &str) -> DimScore {
    let i = DIMS.iter().position(|(k, _)| *k == key);
    DimScore {
        key: key.into(),
        label: i.map_or(key, |i| DIMS[i].1).into(),
        label_en: i.map_or(key, |i| DIMS_EN[i]).into(),
        s,
        why,
        why_en,
        formula: formula.into(),
    }
}

/// Earth surface temperature range in K: (January night, August day), MODIS LST or POWER T2M.
pub fn earth_temps_k(e: &EarthSite) -> (f64, f64) {
    let tmin = e
        .lst_night_jan_k
        .or(e.t2m_min_jan_c.map(|c| c + 273.15))
        .unwrap_or(f64::NAN);
    let tmax = e
        .lst_day_aug_k
        .or(e.t2m_max_aug_c.map(|c| c + 273.15))
        .unwrap_or(f64::NAN);
    (tmin, tmax)
}

fn topography(e: &EarthSite, b: &Body) -> DimScore {
    let d = (e.slope_mean_deg - b.slope_mean_deg).abs();
    dim(
        "topography",
        (-d / 10.0).exp(),
        format!(
            "平均傾斜 {}° vs {}°（差 {}°）",
            r1(e.slope_mean_deg),
            b.slope_mean_deg,
            r1(d)
        ),
        format!(
            "Mean slope {}° vs {}° (Δ {}°)",
            r1(e.slope_mean_deg),
            b.slope_mean_deg,
            r1(d)
        ),
        "exp(−|Δ mean slope| / 10°)",
    )
}

fn geology(e: &EarthSite, b: &Body) -> DimScore {
    let ec = lithology_class(e.lithology_ja.as_deref());
    let ox = oxides();
    let (oe, ob) = (&ox[ec], &ox[&b.oxides]);
    let d =
        oe.v.iter()
            .zip(ob.v.iter())
            .map(|(x, y)| (x - y).powi(2))
            .sum::<f64>()
            .sqrt();
    let base = (-d / 20.0).exp();
    // Unconsolidated sediment has no single composition: cap its similarity (low confidence).
    let s = if ec == "sediment" {
        base.min(0.3)
    } else {
        base
    };
    dim(
        "geology",
        s,
        format!(
            "{} vs {}（主要酸化物の距離 {} wt%）{}",
            oe.label,
            ob.label,
            r1(d),
            if ec == "sediment" {
                "・組成不明のため上限0.3"
            } else {
                ""
            }
        ),
        format!(
            "{} vs {} (major-oxide distance {} wt%){}",
            ec.replace('_', " "),
            b.oxides.replace('_', " "),
            r1(d),
            if ec == "sediment" {
                " · composition unknown, capped at 0.3"
            } else {
                ""
            }
        ),
        "exp(−‖Δ 6 major oxides wt%‖ / 20)",
    )
}

fn temperature(e: &EarthSite, b: &Body) -> DimScore {
    let (tmin, tmax) = earth_temps_k(e);
    let d = (tmin - b.tmin).hypot(tmax - b.tmax);
    let s = if d.is_finite() {
        (-d / 150.0).exp()
    } else {
        0.0
    };
    dim(
        "temperature",
        s,
        format!(
            "地表温度 {}–{} K vs {}–{} K",
            tmin.round(),
            tmax.round(),
            b.tmin,
            b.tmax
        ),
        format!(
            "Surface temperature {}–{} K vs {}–{} K",
            tmin.round(),
            tmax.round(),
            b.tmin,
            b.tmax
        ),
        "exp(−‖(ΔTmin, ΔTmax)‖ / 150 K)",
    )
}

fn lighting(e: &EarthSite, b: &Body) -> DimScore {
    let (e0, e1) = noon_elevation_range(e.lat, World::Earth.info().axial_tilt_deg);
    let (b0, b1) = noon_elevation_range(b.lat, b.world.info().axial_tilt_deg);
    let d = (e0 - b0).hypot(e1 - b1);
    dim(
        "lighting",
        (-d / 40.0).exp(),
        format!(
            "南中高度 {}–{}° vs {}–{}°",
            e0.round(),
            e1.round(),
            b0.round(),
            b1.round()
        ),
        format!(
            "Noon sun elevation {}–{}° vs {}–{}°",
            e0.round(),
            e1.round(),
            b0.round(),
            b1.round()
        ),
        "exp(−‖Δ yearly noon sun elevation (min, max)‖ / 40°)",
    )
}

fn regolith(e: &EarthSite) -> DimScore {
    let bare_ndvi = e.ndvi_min.map_or(0.0, |n| clamp01((0.6 - n) / 0.6));
    let bare = bare_ndvi.max(e.barren_frac.unwrap_or(0.0));
    let dry = clamp01(1.0 - e.precip_mm_yr.unwrap_or(2000.0) / 2000.0);
    let ndvi = |v: Option<f64>| v.map_or("–".to_string(), |x| format!("{x:.2}"));
    let mm = |v: Option<f64>| v.map_or("–".to_string(), |x| format!("{}", x.round()));
    dim(
        "regolith",
        0.6 * bare + 0.4 * dry,
        format!(
            "裸地 {}%（NDVI最小 {}）・乾燥 {}%（年降水 {} mm）",
            (bare * 100.0).round(),
            ndvi(e.ndvi_min),
            (dry * 100.0).round(),
            mm(e.precip_mm_yr)
        ),
        format!(
            "Bare ground {}% (min NDVI {}) · dryness {}% (precipitation {} mm/yr)",
            (bare * 100.0).round(),
            ndvi(e.ndvi_min),
            (dry * 100.0).round(),
            mm(e.precip_mm_yr)
        ),
        "0.6 × bare-ground index + 0.4 × dryness index",
    )
}

pub fn score_pair(e: &EarthSite, b: &Body, w: &Weights) -> PairScore {
    let dims = vec![
        topography(e, b),
        geology(e, b),
        temperature(e, b),
        lighting(e, b),
        regolith(e),
    ];
    let (mut sum, mut wsum) = (0.0, 0.0);
    for d in &dims {
        let wk = w.get(&d.key).copied().unwrap_or(0.0);
        sum += d.s * wk;
        wsum += wk;
    }
    let raw = if wsum > 0.0 { sum / wsum } else { 0.0 };
    let excluded = screen_out(e);
    PairScore {
        body_id: b.id.clone(),
        total: if excluded.is_some() { 0.0 } else { raw },
        raw,
        excluded,
        dims,
    }
}

/// All Moon/Mars targets ranked for one Earth site, best first.
pub fn rank_bodies(e: &EarthSite, w: &Weights) -> Vec<PairScore> {
    let mut v: Vec<_> = bodies().iter().map(|b| score_pair(e, b, w)).collect();
    v.sort_by(|a, b| b.total.total_cmp(&a.total));
    v
}

#[derive(Debug, Clone, Serialize)]
pub struct SiteRanking {
    pub earth_id: String,
    pub ranks: Vec<PairScore>,
}

/// Every Earth site with its ranked targets, sites ordered by their best match.
pub fn rank_all(w: &Weights) -> Vec<SiteRanking> {
    let mut v: Vec<_> = earth_sites()
        .iter()
        .map(|e| SiteRanking {
            earth_id: e.id.clone(),
            ranks: rank_bodies(e, w),
        })
        .collect();
    v.sort_by(|a, b| b.ranks[0].total.total_cmp(&a.ranks[0].total));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scores_are_unit_interval_and_sorted() {
        let w = profile("balanced").w;
        let all = rank_all(&w);
        assert_eq!(all.len(), earth_sites().len());
        for s in &all {
            for p in &s.ranks {
                assert!((0.0..=1.0).contains(&p.total), "{} {}", s.earth_id, p.total);
                assert_eq!(p.dims.len(), 5);
            }
            assert!(s.ranks.windows(2).all(|x| x[0].total >= x[1].total));
        }
        assert!(all
            .windows(2)
            .all(|x| x[0].ranks[0].total >= x[1].ranks[0].total));
    }

    #[test]
    fn urban_control_is_screened_out() {
        let e = earth_sites()
            .iter()
            .find(|e| e.landcover_center.as_deref() == Some("Urban and Built-up Lands"));
        if let Some(e) = e {
            let p = score_pair(e, &bodies()[0], &profile("balanced").w);
            assert_eq!(p.total, 0.0);
            assert!(p.excluded.is_some() && p.raw > 0.0);
        }
    }

    #[test]
    fn identical_slope_gives_full_topography() {
        let mut e = earth_sites()[0].clone();
        let b = &bodies()[0];
        e.slope_mean_deg = b.slope_mean_deg;
        assert!((topography(&e, b).s - 1.0).abs() < 1e-12);
    }
}
