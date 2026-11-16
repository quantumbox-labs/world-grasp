//! Export the Mars datasets as CSV tables for DuckDB/parquet (scripts/build-mars-tables.mjs):
//!   cargo run -q -p analog-core --example export_tables -- <out dir>
//! rover_traverse.csv  mission, drive, seq, sol, lat, lon, elev_m, km (traverse::points)
//! eva.csv             id, country, crew, vehicle, date, hours (eva::parse of the data.nasa.gov CSV)
use analog_core::{eva, traverse};
use std::fmt::Write as _;

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn main() {
    let out = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "data/derived".into()),
    );
    std::fs::create_dir_all(&out).unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/public/data");

    let t: traverse::Traverse =
        serde_json::from_str(&std::fs::read_to_string(root.join("m20_traverse.json")).unwrap())
            .unwrap();
    let mut s = String::from("mission,drive,seq,sol,lat,lon,elev_m,km\n");
    let pts = traverse::points(&t);
    for p in &pts {
        writeln!(
            s,
            "m20,{},{},{},{},{},{},{}",
            p.drive, p.seq, p.sol, p.lat, p.lon, p.elev_m, p.km
        )
        .unwrap();
    }
    std::fs::write(out.join("rover_traverse.csv"), s).unwrap();

    let e = eva::parse(&std::fs::read_to_string(root.join("eva.csv")).unwrap());
    let mut s = String::from("id,country,crew,vehicle,date,hours\n");
    for r in &e {
        writeln!(
            s,
            "{},{},{},{},{},{}",
            csv_field(&r.id),
            csv_field(&r.country),
            csv_field(&r.crew),
            csv_field(&r.vehicle),
            csv_field(&r.date),
            r.hours
        )
        .unwrap();
    }
    std::fs::write(out.join("eva.csv"), s).unwrap();
    println!(
        "rover_traverse: {} rows, eva: {} rows -> {}",
        pts.len(),
        e.len(),
        out.display()
    );
}
