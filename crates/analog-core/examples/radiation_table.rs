//! CSV of the radiation figures the core uses (radiation.rs), for the DuckDB table mars_radiation:
//!   cargo run -q -p analog-core --example radiation_table > out.csv
use analog_core::radiation as r;

fn main() {
    let hassler =
        "Hassler et al. 2014, Science 343, 1244797 (Curiosity RAD, Gale crater, first 300 sols)";
    let std = "NASA-STD-3001 Vol. 1 (V1 4030); NASA OCHMO radiation protection technical brief";
    println!("quantity,value,sigma,unit,source");
    println!(
        "surface_dose_equivalent_rate,{},{},mSv/day,\"{hassler}\"",
        r::DOSE_EQ_MSV_PER_DAY,
        r::DOSE_EQ_SIGMA
    );
    println!(
        "surface_absorbed_dose_rate,{},0.040,mGy/day,\"{hassler}\"",
        r::ABSORBED_MGY_PER_DAY
    );
    println!(
        "career_effective_dose_limit,{},,mSv,\"{std}\"",
        r::CAREER_LIMIT_MSV
    );
    println!(
        "solar_particle_event_limit,{},,mSv per event,\"{std}\"",
        r::SPE_LIMIT_MSV
    );
}
