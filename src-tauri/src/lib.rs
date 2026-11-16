//! Desktop shell. The web UI calls analog-core through WASM in both builds, so the web
//! version and the desktop version always compute the same numbers. The commands below
//! expose the same core natively for desktop-only features later (local files, offline tiles).

use analog_core::{route, scoring, world::World};

#[cfg(feature = "agent")]
mod agent;
mod voice;

#[tauri::command]
fn rank_all(profile: String) -> Vec<scoring::SiteRanking> {
    scoring::rank_all(&scoring::profile(&profile).w)
}

#[tauri::command]
fn evaluate_route(
    world: World,
    points: Vec<route::Waypoint>,
    params: route::EvaParams,
) -> route::RouteEval {
    route::evaluate_route(world, &points, params)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "agent")]
    let builder =
        builder
            .manage(agent::AgentState::default())
            .invoke_handler(tauri::generate_handler![
                rank_all,
                evaluate_route,
                agent::agent_start,
                agent::agent_models,
                agent::agent_prompt,
                agent::agent_tool_result,
                agent::agent_abort,
                voice::voice_status,
                voice::voice_transcribe
            ]);
    #[cfg(not(feature = "agent"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        rank_all,
        evaluate_route,
        voice::voice_status,
        voice::voice_transcribe
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
