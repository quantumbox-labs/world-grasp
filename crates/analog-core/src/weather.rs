//! Air temperature at Jezero by local solar time (Perseverance MEDA) and how it changes the
//! cooling-water use of a walk.
//!
//! The suit's water evaporator rejects the heat the body makes minus what leaks out through the
//! suit to the cold air (NASA notes that in the cold Mars environment more heat leak could be
//! designed into the suit: Spacesuit Water Membrane Evaporator work, NTRS 20140003403). So
//!   water rate ∝ M − U (T_skin − T_air)
//! normalised to the conditions of the NASA walk-back tests the 1.15 water/O₂ ratio comes from:
//! - M = 350 W, average metabolic rate of a Mars EVA (NASA, NTRS 20110010198, "Avg Metabolic
//!   Rate: 350 W (1194 BTU/hr)");
//! - T_ref = 295 K, room temperature of the lab tests (estimate, 目安);
//! - T_skin = 306 K, about 33 °C mean skin temperature (estimate, 目安);
//! - U = 0.5 W/K heat-leak conductance of an insulated suit (estimate, 目安: no measured Mars
//!   suit value is published).
//!
//! Pressure (MEDA) is shown but does not enter the cooling model.
use serde::{Deserialize, Serialize};

pub const METABOLIC_W: f64 = 350.0;
pub const T_REF_K: f64 = 295.0;
pub const T_SKIN_K: f64 = 306.0;
pub const LEAK_W_PER_K: f64 = 0.5;
/// Length of a Mars solar day in Earth hours (24 h 39 m 35 s): local solar time runs this much slower.
pub const SOL_HOURS: f64 = 24.659_7;

/// Cooling-water use relative to the walk-back tests at air temperature `t_k` (1.0 at 295 K,
/// below 1 in colder air), kept within 0.5–1.2.
pub fn water_factor(t_k: f64) -> f64 {
    let rate = |t: f64| METABOLIC_W - LEAK_W_PER_K * (T_SKIN_K - t);
    (rate(t_k) / rate(T_REF_K)).clamp(0.5, 1.2)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HourMean {
    pub hour: usize,
    pub air_temp_k: Option<f64>,
    pub pressure_pa: Option<f64>,
    #[serde(default)]
    pub sols: usize,
}

/// jezero_weather.json: hourly means by local true solar time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Weather {
    pub hours: Vec<HourMean>,
    #[serde(default)]
    pub src: String,
}

impl Weather {
    /// Air temperature at local solar hour `h` (0–24, wraps), linear between hourly means.
    pub fn temp_at(&self, h: f64) -> Option<f64> {
        let h = h.rem_euclid(24.0);
        let (a, f) = (h.floor() as usize % 24, h.fract());
        let get = |i: usize| {
            self.hours
                .iter()
                .find(|x| x.hour == i % 24)
                .and_then(|x| x.air_temp_k)
        };
        match (get(a), get(a + 1)) {
            (Some(x), Some(y)) => Some(x + (y - x) * f),
            (Some(x), None) | (None, Some(x)) => Some(x),
            _ => None,
        }
    }
    pub fn pressure_at(&self, h: f64) -> Option<f64> {
        let i = (h.rem_euclid(24.0).round() as usize) % 24;
        self.hours
            .iter()
            .find(|x| x.hour == i)
            .and_then(|x| x.pressure_pa)
    }
    /// Mean cooling-water factor over a walk starting at local solar hour `start_h` and lasting
    /// `hours` Earth hours (sampled every 6 minutes).
    pub fn mean_water_factor(&self, start_h: f64, hours: f64) -> f64 {
        let n = ((hours * 10.0).ceil() as usize).max(1);
        let sum: f64 = (0..n)
            .map(|k| {
                let t = (k as f64 + 0.5) / n as f64 * hours;
                self.temp_at(start_h + t * 24.0 / SOL_HOURS)
                    .map_or(1.0, water_factor)
            })
            .sum();
        sum / n as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn colder_air_uses_less_water() {
        assert!((water_factor(T_REF_K) - 1.0).abs() < 1e-12);
        assert!(water_factor(200.0) < water_factor(260.0));
        assert!(water_factor(200.0) > 0.8);
        let w = Weather {
            hours: (0..24)
                .map(|h| HourMean {
                    hour: h,
                    air_temp_k: Some(200.0 + h as f64),
                    pressure_pa: Some(700.0),
                    sols: 1,
                })
                .collect(),
            src: String::new(),
        };
        assert!((w.temp_at(10.5).unwrap() - 210.5).abs() < 1e-9);
        assert!(w.mean_water_factor(12.0, 2.0) > w.mean_water_factor(2.0, 2.0));
    }
}
