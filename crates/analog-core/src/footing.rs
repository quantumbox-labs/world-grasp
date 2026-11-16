//! Footing: how hard the ground is to walk on, from orbital NASA data, as a factor η on the time
//! (and so on the O₂ and cooling water) of each step: 1.0 is firm, smooth ground.
//!
//! Inputs per grid cell:
//! - THEMIS quantitative thermal inertia, 100 m mosaic (Mars Odyssey; ASU, `thm_ti_100m_32bit`),
//!   J m⁻² K⁻¹ s⁻½. Low values are loose fine material (dust, sand), high values are coarse, rocky
//!   or cemented ground (Presley & Christensen 1997, JGR 102; Putzig & Mellon 2007, Icarus 191:
//!   above ~400 rock, duricrust or bedrock). Rock abundance is part of this signal; there is no
//!   numeric rock-abundance map finer than Viking IRTM's 1° cells, so it is not counted twice.
//! - TES Dust Cover Index (Ruff & Christensen 2002, JGR 107), 16 px/°: below 0.94 the surface is
//!   dust-mantled, above 0.96 dust-free.
//!
//! Coefficients:
//! - loose sand: walking on sand costs 1.6–2.5× the energy of a firm surface (Lejeune, Willems &
//!   Heglund 1998, J Exp Biol 201: 2071); the low end is used ([`ETA_LOOSE`]).
//! - firm ground: dirt-road terrain coefficient 1.1 relative to blacktop (Soule & Goldman 1972,
//!   J Appl Physiol 32: 706) ([`ETA_FIRM`]).
//! - between the two thermal-inertia anchors η follows log(TI) linearly — an estimate (目安).
//! - dust mantle: +10 % — an estimate (目安), no measured walking cost on Mars dust exists.
//!
//! The factor multiplies hours at constant metabolic rate, so loose ground is both slower and
//! uses more O₂ and water per km, which is what the sand measurements show (cost per distance).
use serde::{Deserialize, Serialize};

/// Thermal inertia at or below which the ground counts as loose sand / fines.
pub const TI_LOOSE: f64 = 150.0;
/// Thermal inertia at or above which the ground counts as firm (rock, duricrust, bedrock).
pub const TI_FIRM: f64 = 400.0;
/// Energy-per-distance ratio on loose sand (Lejeune et al. 1998, lower bound).
pub const ETA_LOOSE: f64 = 1.6;
/// Terrain coefficient of firm unpaved ground (Soule & Goldman 1972, dirt road).
pub const ETA_FIRM: f64 = 1.1;
/// Dust Cover Index below which the surface is dust-mantled (Ruff & Christensen 2002).
pub const DCI_DUSTY: f64 = 0.94;
/// Extra factor on dust-mantled ground (estimate).
pub const DUST_EXTRA: f64 = 1.1;

/// Footing factor η (≥ 1) from thermal inertia and the dust cover index; `None` inputs are ignored
/// (no thermal inertia: firm ground assumed is not safe, so the loose-sand value is used).
pub fn eta(ti: Option<f64>, dci: Option<f64>) -> f64 {
    let base = match ti {
        Some(ti) if ti.is_finite() && ti > 0.0 => {
            let f = ((ti.ln() - TI_LOOSE.ln()) / (TI_FIRM.ln() - TI_LOOSE.ln())).clamp(0.0, 1.0);
            ETA_LOOSE + (ETA_FIRM - ETA_LOOSE) * f
        }
        _ => ETA_LOOSE,
    };
    match dci {
        Some(d) if d.is_finite() && d < DCI_DUSTY => base * DUST_EXTRA,
        _ => base,
    }
}

/// Ground class for the map legend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Class {
    Loose,
    Mixed,
    Firm,
}
pub fn class(ti: f64) -> Class {
    if ti <= TI_LOOSE {
        Class::Loose
    } else if ti >= TI_FIRM {
        Class::Firm
    } else {
        Class::Mixed
    }
}

/// Footing layer of an elevation grid (same rows / cols), as stored in jezero_footing.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Footing {
    pub rows: usize,
    pub cols: usize,
    /// Row-major thermal inertia; `None` where missing. Empty = not counted (η starts at 1.0).
    #[serde(default)]
    pub ti: Vec<Option<f32>>,
    /// Row-major dust cover index; `None` where missing.
    #[serde(default)]
    pub dci: Vec<Option<f32>>,
    /// Row-major extra factor from the surface seen in HiRISE images (sand ripples, rocky ground),
    /// multiplied onto η; `None` or empty = not counted.
    #[serde(default)]
    pub surface: Vec<Option<f32>>,
    #[serde(default)]
    pub src: String,
}

impl Footing {
    /// η per cell.
    pub fn etas(&self) -> Vec<f32> {
        (0..self.rows * self.cols)
            .map(|i| {
                let base = if self.ti.is_empty() {
                    1.0
                } else {
                    eta(
                        self.ti.get(i).copied().flatten().map(f64::from),
                        self.dci.get(i).copied().flatten().map(f64::from),
                    )
                };
                let extra = self
                    .surface
                    .get(i)
                    .copied()
                    .flatten()
                    .map(f64::from)
                    .filter(|f| f.is_finite() && *f >= 1.0)
                    .unwrap_or(1.0);
                (base * extra) as f32
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors_and_monotonic() {
        assert!((eta(Some(100.0), None) - ETA_LOOSE).abs() < 1e-12);
        assert!((eta(Some(150.0), None) - ETA_LOOSE).abs() < 1e-12);
        assert!((eta(Some(400.0), None) - ETA_FIRM).abs() < 1e-12);
        assert!((eta(Some(900.0), None) - ETA_FIRM).abs() < 1e-12);
        let (a, b) = (eta(Some(200.0), None), eta(Some(300.0), None));
        assert!(a > b && b > ETA_FIRM && a < ETA_LOOSE);
        assert!((eta(Some(500.0), Some(0.92)) - ETA_FIRM * DUST_EXTRA).abs() < 1e-12);
        assert!((eta(Some(500.0), Some(0.97)) - ETA_FIRM).abs() < 1e-12);
        assert_eq!(eta(None, None), ETA_LOOSE);
    }

    #[test]
    fn surface_factor_multiplies() {
        let f: Footing = serde_json::from_str(
            r#"{"rows":1,"cols":3,"ti":[400,400,null],"dci":[null,null,null],"surface":[1.3,null,1.15]}"#,
        )
        .unwrap();
        let e = f.etas();
        assert!((e[0] as f64 - ETA_FIRM * 1.3).abs() < 1e-5);
        assert!((e[1] as f64 - ETA_FIRM).abs() < 1e-5);
        assert!((e[2] as f64 - ETA_LOOSE * 1.15).abs() < 1e-5);
        let only: Footing =
            serde_json::from_str(r#"{"rows":1,"cols":2,"surface":[1.3,null]}"#).unwrap();
        let e = only.etas();
        assert!((e[0] - 1.3).abs() < 1e-5 && (e[1] - 1.0).abs() < 1e-5);
    }
}
