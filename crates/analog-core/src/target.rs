//! Target-first view of #10: pick a Moon/Mars target and a rehearsal test, rank every Hokkaido
//! site for it, and state in numbers what Hokkaido cannot reproduce ("gaps").

use crate::data::{bodies, earth_sites, Body, EarthSite};
use crate::scoring::{earth_temps_k, profile, score_pair, PairScore};
use crate::world::{noon_elevation_range, World};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SiteScore {
    pub earth_id: String,
    #[serde(flatten)]
    pub score: PairScore,
}

/// Every Hokkaido site scored against one target, best first. Unknown body id → empty.
pub fn rank_sites(body_id: &str, profile_id: &str) -> Vec<SiteScore> {
    let Some(b) = bodies().iter().find(|b| b.id == body_id) else {
        return vec![];
    };
    let w = profile(profile_id).w;
    let mut v: Vec<_> = earth_sites()
        .iter()
        .map(|e| SiteScore {
            earth_id: e.id.clone(),
            score: score_pair(e, b, &w),
        })
        .collect();
    v.sort_by(|a, b| b.score.total.total_cmp(&a.score.total));
    v
}

/// One thing Hokkaido cannot reproduce for this target, with the size of the gap.
#[derive(Debug, Clone, Serialize)]
pub struct Gap {
    pub key: &'static str,
    pub label: &'static str,
    pub label_en: &'static str,
    /// Short number for the badge, e.g. "ΔT 165 K".
    pub value: String,
    pub detail: String,
    pub detail_en: String,
    /// The gap matters for the chosen test (shown first, in red).
    pub critical: bool,
}

const COLD_K: f64 = 30.0;
const SUN_DEG: f64 = 20.0;

/// Which tests each gap is critical for.
fn critical_for(key: &str, test: &str) -> bool {
    let tests: &[&str] = match key {
        "gravity" => &["landing", "walk", "build", "balanced"],
        "vacuum" => &["ice", "walk", "build", "caves"],
        "cold" => &["ice", "walk", "caves", "balanced"],
        "hot" => &["walk", "build"],
        "sun" => &["landing", "walk", "ice", "balanced"],
        "radiation" => &["walk", "caves"],
        _ => &[],
    };
    tests.contains(&test)
}

/// Gaps between a Hokkaido site and a target for a test, critical ones first.
pub fn gaps(e: &EarthSite, b: &Body, test: &str) -> Vec<Gap> {
    let g_e = World::Earth.info().gravity;
    let g_b = b.world.info().gravity;
    let (body_ja, body_en) = match b.world {
        World::Moon => ("月", "Moon"),
        World::Mars => ("火星", "Mars"),
        World::Earth => ("地球", "Earth"),
    };
    let mut v = Vec::new();
    let mut push = |key, label, label_en, value: String, detail: String, detail_en: String| {
        v.push(Gap {
            key,
            label,
            label_en,
            value,
            detail,
            detail_en,
            critical: critical_for(key, test),
        })
    };

    let ratio = g_e / g_b;
    push(
        "gravity",
        "重力",
        "Gravity",
        format!("1/{:.1} g", ratio),
        format!(
            "{body_ja}の重力 {g_b} m/s² は地球（{g_e} m/s²）の約 1/{ratio:.1}。歩き方・着陸の荷重・機械の接地は北海道では再現できない（放物線飛行や吊り下げ装置が必要）"
        ),
        format!(
            "{body_en} gravity {g_b} m/s² is about 1/{ratio:.1} of Earth's {g_e} m/s². Gait, landing loads and wheel traction cannot be rehearsed in Hokkaido (needs parabolic flights or offloading rigs)"
        ),
    );

    let (atm, atm_en, val) = match b.world {
        World::Mars => (
            "火星の大気は約 0.6 kPa の CO₂（地球の約 0.6%）",
            "Mars has a ~0.6 kPa CO₂ atmosphere (~0.6% of Earth's)",
            "0.6 kPa CO₂",
        ),
        _ => (
            "月は真空（大気なし）",
            "The Moon is a vacuum (no atmosphere)",
            "vacuum",
        ),
    };
    push(
        "vacuum",
        "大気・真空",
        "Atmosphere",
        val.into(),
        format!("{atm}。氷の昇華、宇宙服の冷却、粉じんのふるまいは真空チャンバーでしか確かめられない"),
        format!("{atm_en}. Ice sublimation, suit cooling and dust behaviour can only be tested in a vacuum chamber"),
    );

    let (tmin, tmax) = earth_temps_k(e);
    if tmin.is_finite() && tmin - b.tmin > COLD_K {
        let d = tmin - b.tmin;
        push(
            "cold",
            "低温",
            "Cold",
            format!("ΔT {:.0} K", d),
            format!(
                "北海道で一番寒い時（1月の夜）でも {:.0} K、{} は {} K。約 {:.0} K 届かない",
                tmin, b.ja, b.tmin, d
            ),
            format!(
                "Even a January night here is {:.0} K; {} reaches {} K. About {:.0} K short",
                tmin, b.name, b.tmin, d
            ),
        );
    }
    if tmax.is_finite() && b.tmax - tmax > COLD_K {
        let d = b.tmax - tmax;
        push(
            "hot",
            "高温",
            "Heat",
            format!("ΔT {:.0} K", d),
            format!(
                "北海道の夏の昼は {:.0} K、{} は {} K。約 {:.0} K 届かない",
                tmax, b.ja, b.tmax, d
            ),
            format!(
                "A summer day here is {:.0} K; {} reaches {} K. About {:.0} K short",
                tmax, b.name, b.tmax, d
            ),
        );
    }

    let (e0, e1) = noon_elevation_range(e.lat, World::Earth.info().axial_tilt_deg);
    let (b0, b1) = noon_elevation_range(b.lat, b.world.info().axial_tilt_deg);
    let d = (e0 - b0).hypot(e1 - b1);
    if d > SUN_DEG {
        push(
            "sun",
            "太陽の高さ",
            "Sun angle",
            format!("{:.0}–{:.0}°", b0, b1),
            format!(
                "{} の正午の太陽は {:.0}–{:.0}°、北海道は {:.0}–{:.0}°。地平線すれすれの光と長い影は再現できない（冬の北斜面で一部だけ近づく）",
                b.ja, b0, b1, e0, e1
            ),
            format!(
                "Noon sun at {} is {:.0}–{:.0}°, here {:.0}–{:.0}°. Grazing light and long shadows cannot be reproduced (north slopes in winter come partly close)",
                b.name, b0, b1, e0, e1
            ),
        );
    }

    push(
        "radiation",
        "放射線",
        "Radiation",
        "no shielding".into(),
        format!("{body_ja}には磁場と厚い大気の盾がない。被ばくの条件は地上では再現できない"),
        format!("{body_en} has no magnetic field or thick atmosphere for shielding. Radiation exposure cannot be reproduced on the ground"),
    );

    v.sort_by_key(|g| !g.critical);
    v
}

/// Gaps by ids. Unknown ids → empty.
pub fn gaps_by_id(earth_id: &str, body_id: &str, test: &str) -> Vec<Gap> {
    let e = earth_sites().iter().find(|e| e.id == earth_id);
    let b = bodies().iter().find(|b| b.id == body_id);
    match (e, b) {
        (Some(e), Some(b)) => gaps(e, b, test),
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_every_site_best_first() {
        let r = rank_sites("mons_mouton", "landing");
        assert_eq!(r.len(), earth_sites().len());
        assert!(r.windows(2).all(|x| x[0].score.total >= x[1].score.total));
        assert!(rank_sites("nope", "landing").is_empty());
    }

    #[test]
    fn every_test_profile_exists() {
        for t in ["landing", "ice", "walk", "caves", "build"] {
            assert_eq!(profile(t).id, t);
        }
    }

    #[test]
    fn polar_moon_gaps_are_numeric() {
        let g = gaps_by_id("tokachi", "mons_mouton", "ice");
        let cold = g.iter().find(|x| x.key == "cold").expect("cold gap");
        assert!(cold.critical && cold.value.starts_with("ΔT "));
        assert!(g.iter().any(|x| x.key == "sun"));
        assert!(g.iter().any(|x| x.key == "gravity" && x.value == "1/6.1 g"));
        // critical gaps come first
        let first_non = g.iter().position(|x| !x.critical).unwrap_or(g.len());
        assert!(g[first_non..].iter().all(|x| !x.critical));
    }

    #[test]
    fn mars_has_thin_air_not_vacuum() {
        let g = gaps_by_id("tokachi", "jezero", "walk");
        assert!(g
            .iter()
            .any(|x| x.key == "vacuum" && x.value.contains("CO₂")));
    }
}
