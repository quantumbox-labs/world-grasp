//! Radiation on the surface during a walk: the third budget next to O₂ and cooling water.
//!
//! Dose rate: Curiosity RAD at Gale crater, first 300 sols (solar maximum): galactic cosmic rays
//! give 0.210 ± 0.040 mGy/day absorbed dose and 0.64 ± 0.12 mSv/day dose equivalent (Hassler et
//! al. 2014, Science 343, 1244797, doi:10.1126/science.1244797). Jezero is ~2 km higher than Gale,
//! so a little less atmosphere above it: the Gale rate is used as an estimate (目安), and a solar
//! particle event can add far more for hours (not modelled; the walk-back rule is the defence).
//! The suit adds little shielding compared with RAD on the rover deck, so none is subtracted.
//!
//! Limits (NASA-STD-3001 Vol. 1, Rev. B/C):
//! - career effective dose < 600 mSv (V1 4030, Career Space Permissible Exposure Limit);
//! - 250 mSv per solar particle event (short-term limit), quoted in the NASA OCHMO radiation brief.
use serde::Serialize;

/// Dose-equivalent rate on the surface, mSv per day (Hassler et al. 2014).
pub const DOSE_EQ_MSV_PER_DAY: f64 = 0.64;
/// Its stated uncertainty, mSv per day.
pub const DOSE_EQ_SIGMA: f64 = 0.12;
/// Absorbed dose rate, mGy per day (Hassler et al. 2014), ± 0.040.
pub const ABSORBED_MGY_PER_DAY: f64 = 0.210;
/// NASA career effective-dose limit, mSv (NASA-STD-3001 V1 4030).
pub const CAREER_LIMIT_MSV: f64 = 600.0;
/// NASA short-term limit per solar particle event, mSv.
pub const SPE_LIMIT_MSV: f64 = 250.0;

/// Dose equivalent (mSv) for `hours` on the surface.
pub fn dose_msv(hours: f64) -> f64 {
    DOSE_EQ_MSV_PER_DAY * hours.max(0.0) / 24.0
}

#[derive(Debug, Clone, Serialize)]
pub struct Exposure {
    pub dose_msv: f64,
    /// Share of the career limit (0–1).
    pub career_share: f64,
    /// Hours on the surface that would reach the career limit at this rate.
    pub hours_to_career_limit: f64,
}

pub fn exposure(hours: f64) -> Exposure {
    let d = dose_msv(hours);
    Exposure {
        dose_msv: d,
        career_share: d / CAREER_LIMIT_MSV,
        hours_to_career_limit: CAREER_LIMIT_MSV / DOSE_EQ_MSV_PER_DAY * 24.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn eight_hours() {
        let e = exposure(8.0);
        assert!((e.dose_msv - 0.64 / 3.0).abs() < 1e-12);
        assert!(e.career_share < 0.001);
        assert!((e.hours_to_career_limit / 24.0 - 937.5).abs() < 1e-9);
    }
}
