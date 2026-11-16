//! Voice questions, transcribed on this machine with whisper.cpp (no network).
//!
//! The webview records the microphone and sends 16 kHz mono WAV bytes; `voice_transcribe` runs
//! `whisper-cli` on them and returns the text, which goes into the question panel.
//!   whisper-cli: WALKBACK_WHISPER_CLI, else Homebrew's (`brew install whisper-cpp`), else PATH.
//!   model:       WALKBACK_WHISPER_MODEL, else the first of ggml-medium / small / base .bin in
//!                ~/Library/Application Support/com.hokkaido-analog-finder.app/whisper/ or
//!                ~/.cache/whisper/ (medium transcribed our 10 s Japanese test word for word in ~5 s).

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const MODELS: [&str; 3] = ["ggml-medium.bin", "ggml-small.bin", "ggml-base.bin"];

fn find_cli() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("WALKBACK_WHISPER_CLI").map(PathBuf::from) {
        return p.is_file().then_some(p);
    }
    let known = [
        "/opt/homebrew/bin/whisper-cli",
        "/usr/local/bin/whisper-cli",
    ];
    if let Some(p) = known.iter().map(PathBuf::from).find(|p| p.is_file()) {
        return Some(p);
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join("whisper-cli"))
            .find(|p| p.is_file())
    })
}

fn find_model() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("WALKBACK_WHISPER_MODEL").map(PathBuf::from) {
        return p.is_file().then_some(p);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let dirs = [
        home.join("Library/Application Support/com.hokkaido-analog-finder.app/whisper"),
        home.join(".cache/whisper"),
    ];
    MODELS
        .iter()
        .flat_map(|m| dirs.iter().map(move |d| d.join(m)))
        .find(|p| p.is_file())
}

#[derive(Serialize)]
pub struct VoiceStatus {
    ok: bool,
    cli: Option<String>,
    model: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub fn voice_status() -> VoiceStatus {
    let (cli, model) = (find_cli(), find_model());
    let error = match (&cli, &model) {
        (None, _) => Some("whisper-cli not found (brew install whisper-cpp)".to_string()),
        (_, None) => Some("no whisper model (put ggml-small.bin or ggml-medium.bin in ~/Library/Application Support/com.hokkaido-analog-finder.app/whisper/)".to_string()),
        _ => None,
    };
    VoiceStatus {
        ok: error.is_none(),
        cli: cli.map(|p| p.display().to_string()),
        model: model.and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())),
        error,
    }
}

/// Run whisper-cli on a WAV file; returns the plain transcript.
pub fn transcribe_file(cli: &Path, model: &Path, wav: &Path, lang: &str) -> Result<String, String> {
    let out = Command::new(cli)
        .args([
            "-m",
            &model.to_string_lossy(),
            "-l",
            lang,
            "-nt",
            "-np",
            "-f",
            &wav.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("could not run whisper-cli: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "whisper-cli failed: {}",
            String::from_utf8_lossy(&out.stderr)
                .lines()
                .last()
                .unwrap_or("")
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" "))
}

#[tauri::command]
pub async fn voice_transcribe(wav: Vec<u8>, lang: String) -> Result<String, String> {
    let cli = find_cli().ok_or("whisper-cli not found (brew install whisper-cpp)")?;
    let model = find_model().ok_or("no whisper model")?;
    let lang = if lang == "en" { "en" } else { "ja" }.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::env::temp_dir().join(format!("walkback-voice-{}.wav", std::process::id()));
        std::fs::write(&path, &wav).map_err(|e| e.to_string())?;
        let r = transcribe_file(&cli, &model, &path, &lang);
        let _ = std::fs::remove_file(&path);
        r
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs whisper-cli and a model on this machine, plus a WAV in WALKBACK_VOICE_WAV.
    ///   WALKBACK_VOICE_WAV=ja.wav cargo test -p analog-finder --lib voice -- --ignored --nocapture
    #[test]
    #[ignore]
    fn transcribes_a_recording() {
        let wav = PathBuf::from(std::env::var("WALKBACK_VOICE_WAV").expect("WALKBACK_VOICE_WAV"));
        let s = voice_status();
        assert!(s.ok, "{:?}", s.error);
        let t0 = std::time::Instant::now();
        let text =
            transcribe_file(&find_cli().unwrap(), &find_model().unwrap(), &wav, "ja").unwrap();
        println!(
            "{:?} in {:.1}s: {text}",
            s.model,
            t0.elapsed().as_secs_f64()
        );
        assert!(text.contains("酸素"), "{text}");
    }
}
