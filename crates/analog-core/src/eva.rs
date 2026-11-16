//! Real EVA durations (data.nasa.gov "Extra-vehicular Activity (EVA) - US and Russia", 375 rows)
//! as a yardstick for how long a planned Mars walk is.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Eva {
    pub id: String,
    pub country: String,
    pub crew: String,
    pub vehicle: String,
    pub date: String,
    pub hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvaStats {
    pub count: usize,
    pub median_h: f64,
    pub p90_h: f64,
    pub max_h: f64,
    pub longest: Option<Eva>,
    /// Sorted durations (hours) for the histogram.
    pub hours: Vec<f64>,
    /// Apollo surface EVAs (vehicle names starting with "Apollo"), hours, sorted.
    pub apollo_hours: Vec<f64>,
}

/// Minimal CSV line splitter with double-quote support.
fn split(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut q = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' if q && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => q = !q,
            ',' if !q => out.push(std::mem::take(&mut cur)),
            _ => cur.push(ch),
        }
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).collect()
}

/// Join physical lines into CSV records (quoted fields may contain newlines).
fn records(csv: &str) -> Vec<String> {
    let mut recs = Vec::new();
    let mut cur = String::new();
    for line in csv.lines() {
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(line);
        if cur.matches('"').count().is_multiple_of(2) {
            recs.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        recs.push(cur);
    }
    recs
}

fn hours(s: &str) -> Option<f64> {
    let (h, m) = s.split_once(':')?;
    let v = h.trim().parse::<f64>().ok()? + m.trim().parse::<f64>().ok()? / 60.0;
    (v > 0.0).then_some(v)
}

pub fn parse(csv: &str) -> Vec<Eva> {
    let recs = records(csv);
    let Some(head) = recs.first() else {
        return vec![];
    };
    let h: Vec<String> = split(head).into_iter().map(|s| s.to_lowercase()).collect();
    let col = |name: &str| h.iter().position(|x| x.starts_with(name));
    let (Some(ci), Some(cc), Some(cr), Some(cv), Some(cd), Some(cu)) = (
        col("eva"),
        col("country"),
        col("crew"),
        col("vehicle"),
        col("date"),
        col("duration"),
    ) else {
        return vec![];
    };
    recs.iter()
        .skip(1)
        .filter_map(|r| {
            let f = split(r);
            let get = |i: usize| {
                f.get(i)
                    .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
                    .unwrap_or_default()
            };
            Some(Eva {
                id: get(ci),
                country: get(cc),
                crew: get(cr),
                vehicle: get(cv),
                date: get(cd),
                hours: hours(&get(cu))?,
            })
        })
        .collect()
}

pub fn stats(evas: &[Eva]) -> EvaStats {
    let mut hrs: Vec<f64> = evas.iter().map(|e| e.hours).collect();
    hrs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut apollo: Vec<f64> = evas
        .iter()
        .filter(|e| e.vehicle.to_lowercase().starts_with("apollo"))
        .map(|e| e.hours)
        .collect();
    apollo.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |q: f64| {
        if hrs.is_empty() {
            0.0
        } else {
            hrs[((hrs.len() - 1) as f64 * q).round() as usize]
        }
    };
    EvaStats {
        count: hrs.len(),
        median_h: at(0.5),
        p90_h: at(0.9),
        max_h: hrs.last().copied().unwrap_or(0.0),
        longest: evas
            .iter()
            .max_by(|a, b| a.hours.partial_cmp(&b.hours).unwrap())
            .cloned(),
        hours: hrs,
        apollo_hours: apollo,
    }
}

/// Share (0–1) of real EVAs that were longer than `h` hours.
pub fn longer_share(s: &EvaStats, h: f64) -> f64 {
    if s.count == 0 {
        return 0.0;
    }
    s.hours.iter().filter(|&&x| x > h).count() as f64 / s.count as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSV: &str = "EVA #,Country,Crew    ,Vehicle,Date,Duration,Purpose \n\
1,USA,Ed White,Gemini IV,06/03/1965,0:36,First U.S. EVA\n\
2,USA,David Scott,Gemini VIII,,0:00,\"EVA not performed, mission aborted\"\n\
3,USA,\"Gene Cernan, Harrison Schmitt\",Apollo 17,12/12/1972,7:37,\"Second lunar\n EVA\"\n\
4,Russia,Leonov,Voskhod 2,03/18/1965,0:12,First EVA\n";

    #[test]
    fn parses_quotes_blank_rows_and_multiline() {
        let e = parse(CSV);
        assert_eq!(e.len(), 3, "the 0:00 row is dropped");
        assert_eq!(e[1].crew, "Gene Cernan, Harrison Schmitt");
        assert!((e[1].hours - (7.0 + 37.0 / 60.0)).abs() < 1e-9);
        let s = stats(&e);
        assert_eq!(s.count, 3);
        assert_eq!(s.apollo_hours.len(), 1);
        assert_eq!(s.longest.as_ref().unwrap().vehicle, "Apollo 17");
        assert!((longer_share(&s, 0.5) - 2.0 / 3.0).abs() < 1e-9);
    }
}
