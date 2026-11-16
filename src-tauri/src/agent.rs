//! pi-rs agent harness for the desktop app (cargo feature "agent").
//!
//! The webview owns the tools (they run the Rust core through WASM and move the map). It sends
//! their specs with `agent_start`; the `WalkbackBridge` extension advertises them to the model and,
//! when the model calls one, emits `agent-tool-call` to the webview and waits (60 s) for
//! `agent_tool_result`. Model text is forwarded as `agent-event`.
//!
//! Model: Anthropic when ANTHROPIC_API_KEY is set, otherwise a local Ollama server.
//! PI_RS_MODEL overrides the model name.

use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use pi_rs::{
    AgentSession, Extension, Model, Outcome, SessionBuilder, SessionControl, SessionEvent, Tool,
    ToolContext, ToolSpec,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, Mutex};

/// Names the tools for each kind of question: small local models pick the right tool and
/// arguments far more often with this than with a generic prompt (see the `bench` test).
pub const SYSTEM_PROMPT: &str = "あなたは火星の船外活動計画の相棒。質問には必ず先にツールを呼ぶ。帰れるか・距離・時間・酸素や冷却水の条件の質問は walkback_check（数値条件は o2_h などの引数に入れる。「Nkm先」は route={\"away_km\":N}）。練習コースは walkback_check に with_rehearsal=true。ローバーが壊れたら・どこで引き返すかは rover_walkback。目的地までの道を自動で引くときは plan_route（lat, lon）。経路の評価・比較・説明は evaluate_route（距離・時間・登り下り・坂・足場・出発時刻別の酸素と冷却水・放射線・区間ごと、出典付き）の数字をそのまま使う。根拠・出典は open_evidence（topic は rover, eva, consumables など）。北海道のどこで・いつ訓練するかは explore_hokkaido。歩いた記録・GPX は import_walk。見せてと言われたら表示ツール（view_3d, view_walk など）で地図を動かす。件数・範囲・一覧など、ほかのツールで答えられない質問は query_nasa に読み取り専用の SELECT を1つ渡して表から引く（集計や WHERE で絞る）。Perseverance が何 km 走ったか・sol ごとの位置は query_nasa で rover_traverse を引く（例: SELECT max(km) FROM rover_traverse WHERE sol <= 1000）。船外活動の回数や時間は eva 表。Jezero の足場（熱慣性・ダスト被覆）は mars_footing 表。船外活動の放射線（Curiosity RAD の線量率と NASA の上限）は mars_radiation 表。Jezero の時刻ごとの気温・気圧（Perseverance MEDA）は mars_weather 表。火星の地名・着陸地点・有人着陸の候補地（場所、大きさ、名前の由来）は mars_names 表（例: SELECT name, lat, lon, diameter_km FROM mars_names WHERE name ILIKE '%Jezero%'）。表や列が分からなければ list_nasa_tables。1列の件数・平均・中央値などは summarize_nasa、グループや2つの条件の比較は compare_nasa、細かい条件は query_nasa。walkback_check は歩く計画の判定だけに使う。答えに書く数字はツールの結果の文に出てくる数字だけを、そのまま写す。自分で計算・換算・四捨五入しない。最後に出典（sources）を一言添える。ユーザーの言語で短く答える。";
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const OLLAMA_URL: &str = "http://127.0.0.1:11434/v1/chat/completions";
const OLLAMA_DEFAULT: &str = "qwen2.5:7b";
const TOOL_TIMEOUT: Duration = Duration::from_secs(60);

pub struct ToolReply {
    pub ok: bool,
    pub output: String,
    pub details: Value,
}

type Pending = Arc<StdMutex<HashMap<String, oneshot::Sender<ToolReply>>>>;
/// Sends an event to the webview (`app.emit` in the app, a closure in tests).
pub type Emit = Arc<dyn Fn(&str, Value) -> Result<(), String> + Send + Sync>;

/// One webview tool, called over the event bridge.
struct BridgeTool {
    spec: ToolSpec,
    emit: Emit,
    pending: Pending,
}

#[async_trait::async_trait]
impl Tool for BridgeTool {
    fn spec(&self) -> ToolSpec {
        self.spec.clone()
    }

    fn use_default_timeout(&self) -> bool {
        false // our own 60 s wait below; explore_hokkaido loads duckdb on its first call
    }

    async fn invoke(&self, arguments: Value, context: ToolContext) -> Outcome {
        let id = context.operation_id.to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        let call = json!({ "id": id, "name": self.spec.name, "args": arguments });
        if let Err(e) = (self.emit)("agent-tool-call", call) {
            self.pending.lock().unwrap().remove(&id);
            return Outcome::Failed(format!("could not reach the app: {e}"));
        }
        let reply = tokio::select! {
            r = tokio::time::timeout(TOOL_TIMEOUT, rx) => r,
            _ = context.cancellation.cancelled() => {
                self.pending.lock().unwrap().remove(&id);
                return Outcome::Failed("cancelled".into());
            }
        };
        match reply {
            Ok(Ok(r)) if r.ok => Outcome::SucceededWithDetails {
                output: r.output,
                details: r.details,
            },
            Ok(Ok(r)) => Outcome::Failed(r.output),
            _ => {
                self.pending.lock().unwrap().remove(&id);
                Outcome::Failed(format!(
                    "{} did not answer within {} s",
                    self.spec.name,
                    TOOL_TIMEOUT.as_secs()
                ))
            }
        }
    }
}

/// Extension exposing the webview's tools to the model.
pub struct WalkbackBridge {
    tools: Vec<Arc<dyn Tool>>,
}

impl WalkbackBridge {
    fn new(specs: &[ToolSpec], emit: Emit, pending: Pending) -> Self {
        let tools = specs
            .iter()
            .map(|s| {
                Arc::new(BridgeTool {
                    spec: s.clone(),
                    emit: emit.clone(),
                    pending: pending.clone(),
                }) as Arc<dyn Tool>
            })
            .collect();
        Self { tools }
    }
}

impl Extension for WalkbackBridge {
    fn id(&self) -> &str {
        "walkback-bridge"
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        self.tools.clone()
    }
}

#[derive(Clone, Serialize)]
pub struct ModelInfo {
    pub provider: &'static str,
    pub model: String,
}

/// Anthropic with ANTHROPIC_API_KEY, else Ollama if its port answers, else an error to show.
/// `preferred` is the local model picked on the settings screen (used when it is installed).
fn pick_model(preferred: Option<String>) -> Result<(Arc<dyn Model>, ModelInfo), String> {
    let name = std::env::var("PI_RS_MODEL")
        .ok()
        .filter(|s| !s.trim().is_empty());
    if let Some(key) = std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
    {
        let m = pi_rs::anthropic::Anthropic::new(ANTHROPIC_URL, &key).map_err(|e| e.to_string())?;
        return Ok((
            Arc::new(m),
            ModelInfo {
                provider: "anthropic",
                model: name.unwrap_or_else(|| "claude-sonnet-4-5".into()),
            },
        ));
    }
    if let Some(installed) = ollama_models() {
        // Settings, else PI_RS_MODEL, else qwen2.5:7b if pulled, else the first installed model that can call tools.
        let model = preferred
            .filter(|p| installed.iter().any(|m| &m.0 == p))
            .or(name)
            .or_else(|| {
                installed
                    .iter()
                    .find(|m| m.0 == OLLAMA_DEFAULT)
                    .map(|m| m.0.clone())
            })
            .or_else(|| installed.iter().find(|m| m.1).map(|m| m.0.clone()))
            .ok_or_else(|| {
                format!("Ollama has no model that can call tools: ollama pull {OLLAMA_DEFAULT}")
            })?;
        let m = pi_rs::ollama::Ollama::new(OLLAMA_URL, None).map_err(|e| e.to_string())?;
        return Ok((
            Arc::new(m),
            ModelInfo {
                provider: "ollama",
                model,
            },
        ));
    }
    Err(
        format!("no model: set ANTHROPIC_API_KEY, or start Ollama (ollama serve; ollama pull {OLLAMA_DEFAULT})"),
    )
}

/// Installed Ollama models as (name, can call tools), or None when no server answers.
fn ollama_models() -> Option<Vec<(String, bool)>> {
    use std::io::{Read, Write};
    let addr: SocketAddr = "127.0.0.1:11434".parse().unwrap();
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    s.write_all(b"GET /api/tags HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .ok()?;
    let mut body = String::new();
    s.read_to_string(&mut body).ok()?;
    let json: Value = serde_json::from_str(body.split("\r\n\r\n").nth(1)?).ok()?;
    Some(
        json["models"]
            .as_array()?
            .iter()
            .filter_map(|m| {
                let tools = m["capabilities"]
                    .as_array()
                    .is_none_or(|c| c.iter().any(|x| x == "tools"));
                Some((m["name"].as_str()?.to_string(), tools))
            })
            .collect(),
    )
}

struct Live {
    session: Arc<Mutex<AgentSession>>,
    control: SessionControl,
    specs: Vec<ToolSpec>,
    info: ModelInfo,
}

#[derive(Default)]
pub struct AgentState {
    live: StdMutex<Option<Live>>,
    pending: Pending,
}

impl AgentState {
    /// Start (or reuse, when the tools are unchanged) a session over `specs`.
    pub fn start(
        &self,
        specs: Vec<ToolSpec>,
        model: Arc<dyn Model>,
        info: ModelInfo,
        emit: Emit,
    ) -> Result<ModelInfo, String> {
        self.start_with_prompt(specs, model, info, emit, SYSTEM_PROMPT)
    }

    /// `start` with another system prompt (the bench compares prompts).
    pub fn start_with_prompt(
        &self,
        specs: Vec<ToolSpec>,
        model: Arc<dyn Model>,
        info: ModelInfo,
        emit: Emit,
        system_prompt: &str,
    ) -> Result<ModelInfo, String> {
        let mut live = self.live.lock().unwrap();
        if let Some(l) = live.as_ref() {
            if l.specs == specs && l.info.model == info.model && l.info.provider == info.provider {
                return Ok(l.info.clone());
            }
        }
        let bridge = WalkbackBridge::new(&specs, emit.clone(), self.pending.clone());
        let session = SessionBuilder::new(model, info.model.clone())
            .system_prompt(system_prompt)
            .extension(Arc::new(bridge))
            .and_then(|b| b.in_memory())
            .map_err(|e| e.to_string())?;
        let control = session.controls();
        let mut rx = session.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(SessionEvent::Text(t)) => {
                        let _ = emit("agent-event", json!({ "type": "text", "text": t }));
                    }
                    Ok(SessionEvent::RunFailed { message, .. }) => {
                        let _ = emit(
                            "agent-event",
                            json!({ "type": "error", "message": message }),
                        );
                    }
                    Ok(SessionEvent::Closed)
                    | Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                }
            }
        });
        *live = Some(Live {
            session: Arc::new(Mutex::new(session)),
            control,
            specs,
            info: info.clone(),
        });
        Ok(info)
    }

    pub async fn prompt(&self, text: String) -> Result<String, String> {
        let session = self
            .live
            .lock()
            .unwrap()
            .as_ref()
            .map(|l| l.session.clone())
            .ok_or("agent not started")?;
        let mut s = session.lock().await;
        s.prompt(text).await.map_err(|e| e.to_string())
    }

    pub fn tool_result(&self, id: &str, reply: ToolReply) -> bool {
        match self.pending.lock().unwrap().remove(id) {
            Some(tx) => tx.send(reply).is_ok(),
            None => false,
        }
    }

    pub fn abort(&self) {
        if let Some(l) = self.live.lock().unwrap().as_ref() {
            l.control.abort();
        }
    }
}

/// Local models the settings screen can offer (installed in Ollama and able to call tools).
#[tauri::command]
pub fn agent_models() -> Vec<String> {
    ollama_models()
        .unwrap_or_default()
        .into_iter()
        .filter(|m| m.1)
        .map(|m| m.0)
        .collect()
}

#[tauri::command]
pub fn agent_start(
    app: AppHandle,
    state: State<'_, AgentState>,
    tools: Vec<ToolSpec>,
    model: Option<String>,
) -> Result<ModelInfo, String> {
    let (model, info) = pick_model(model.filter(|m| !m.trim().is_empty()))?;
    let emit: Emit = Arc::new(move |event: &str, payload: Value| {
        app.emit(event, payload).map_err(|e| e.to_string())
    });
    state.start(tools, model, info, emit)
}

#[tauri::command]
pub async fn agent_prompt(state: State<'_, AgentState>, text: String) -> Result<String, String> {
    state.prompt(text).await
}

#[tauri::command]
pub fn agent_tool_result(
    state: State<'_, AgentState>,
    id: String,
    ok: bool,
    output: String,
    details: Option<Value>,
) -> bool {
    state.tool_result(
        &id,
        ToolReply {
            ok,
            output,
            details: details.unwrap_or(Value::Null),
        },
    )
}

#[tauri::command]
pub fn agent_abort(state: State<'_, AgentState>) {
    state.abort();
}

#[cfg(test)]
mod tests {
    use super::*;
    use pi_rs::{ModelEvent, ModelRequest, ModelStream, ToolCall};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Calls walkback_check once, then answers with the tool's text.
    struct Fixture(AtomicUsize);
    #[async_trait::async_trait]
    impl Model for Fixture {
        async fn stream(&self, req: ModelRequest) -> pi_rs::Result<ModelStream> {
            let n = self.0.fetch_add(1, Ordering::SeqCst);
            assert!(
                req.tools.iter().any(|t| t.name == "walkback_check"),
                "bridge tool advertised"
            );
            let events = if n == 0 {
                vec![Ok(ModelEvent::Complete {
                    calls: vec![ToolCall {
                        id: "t1".into(),
                        name: "walkback_check".into(),
                        arguments: r#"{"route":"example"}"#.into(),
                    }],
                    usage: None,
                })]
            } else {
                let last = format!("{:?}", req.messages.last());
                assert!(
                    last.contains("帰れる"),
                    "tool output reaches the model: {last}"
                );
                vec![
                    Ok(ModelEvent::Text("帰れます".into())),
                    Ok(ModelEvent::Complete {
                        calls: vec![],
                        usage: None,
                    }),
                ]
            };
            Ok(Box::pin(futures_util::stream::iter(events)))
        }
    }

    #[tokio::test]
    async fn bridge_round_trip() {
        let state = Arc::new(AgentState::default());
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, Value)>();
        let emit: Emit =
            Arc::new(move |e: &str, v: Value| tx.send((e.into(), v)).map_err(|e| e.to_string()));
        let specs = vec![ToolSpec {
            name: "walkback_check".into(),
            description: "check".into(),
            parameters: json!({"type":"object"}),
        }];
        state
            .start(
                specs,
                Arc::new(Fixture(AtomicUsize::new(0))),
                ModelInfo {
                    provider: "fixture",
                    model: "fixture".into(),
                },
                emit,
            )
            .unwrap();
        // Play the webview: answer every tool call.
        let st = state.clone();
        tokio::spawn(async move {
            while let Some((event, v)) = rx.recv().await {
                if event == "agent-tool-call" {
                    assert_eq!(v["name"], "walkback_check");
                    assert_eq!(v["args"]["route"], "example");
                    st.tool_result(
                        v["id"].as_str().unwrap(),
                        ToolReply {
                            ok: true,
                            output: "判定: 帰れる。".into(),
                            details: json!({"ok": true}),
                        },
                    );
                }
            }
        });
        let answer = state.prompt("帰れる？".into()).await.unwrap();
        assert_eq!(answer, "帰れます");
    }

    /// Real model (ANTHROPIC_API_KEY or local Ollama): it must call walkback_check and quote it.
    ///   cargo test -p analog-finder --lib -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn real_model_calls_the_tool() {
        let (model, info) = pick_model(None).expect("a model");
        println!("model: {} / {}", info.provider, info.model);
        let state = Arc::new(AgentState::default());
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, Value)>();
        let emit: Emit =
            Arc::new(move |e: &str, v: Value| tx.send((e.into(), v)).map_err(|e| e.to_string()));
        let specs = vec![ToolSpec {
            name: "walkback_check".into(),
            description: "Check whether the astronaut can walk back to the base on Mars. Returns the verdict and distances.".into(),
            parameters: json!({"type":"object","properties":{"route":{"type":"object","properties":{"away_km":{"type":"number"}}}}}),
        }];
        state.start(specs, model, info, emit).unwrap();
        let st = state.clone();
        let called = Arc::new(AtomicUsize::new(0));
        let c2 = called.clone();
        tokio::spawn(async move {
            while let Some((event, v)) = rx.recv().await {
                if event == "agent-tool-call" {
                    println!("tool call: {v}");
                    c2.fetch_add(1, Ordering::SeqCst);
                    st.tool_result(v["id"].as_str().unwrap(), ToolReply {
                        ok: true,
                        output: "判定: 帰れる。行き 6.1 km / 帰り（まっすぐ）3.0 km、かかる時間 4:36。".into(),
                        details: Value::Null,
                    });
                }
            }
        });
        let answer = state
            .prompt("基地から3km先まで歩いて帰れる？".into())
            .await
            .unwrap();
        println!("answer: {answer}");
        assert!(called.load(Ordering::SeqCst) >= 1, "model called the tool");
        assert!(answer.contains("6.1"), "answer quotes the tool");
    }

    // ---------------------------------------------------------------------------------------
    // Bench: fixed questions × runs × local Ollama models against the app's real tools.
    //   (serve a DUCKDB_LOCAL build, e.g. on :4188)
    //   BENCH_BRIDGE="node scripts/agent-bench/bridge.mjs" BENCH_MODELS=qwen2.5:7b,qwen3.5:4b \
    //   BENCH_RUNS=5 cargo test -p analog-finder --lib bench -- --ignored --nocapture
    // BENCH_PROMPT=original runs the first, generic system prompt for comparison.

    /// The first, generic prompt, kept for comparison (BENCH_PROMPT=original).
    const BENCH_SYSTEM_PROMPT_ORIGINAL: &str = "あなたは火星の船外活動計画の相棒。数字は必ずツールの結果だけを使い、自分で計算・推測しない。答えには出典（ツールの sources）を添える。表示ツールで地図を動かして見せる。ユーザーの言語で答える。";

    struct Q {
        text: &'static str,
        ok: fn(&[(String, Value)]) -> bool,
    }
    fn called(c: &[(String, Value)], name: &str, f: impl Fn(&Value) -> bool) -> bool {
        c.iter().any(|(n, a)| n == name && f(a))
    }
    fn num(v: &Value) -> Option<f64> {
        v.as_f64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    }
    const QUESTIONS: [Q; 8] = [
        Q {
            text: "基地から3km先まで歩いて帰れる？",
            ok: |c| {
                called(c, "walkback_check", |a| {
                    let r = &a["route"];
                    num(&r["away_km"]) == Some(3.0)
                        || num(&a["away_km"]) == Some(3.0)
                        || num(&r["along_rover_km"]) == Some(3.0)
                })
            },
        },
        Q {
            text: "酸素が6時間なら？",
            ok: |c| {
                called(c, "walkback_check", |a| num(&a["o2_h"]) == Some(6.0))
                    || (called(c, "view_set_params", |a| num(&a["o2_h"]) == Some(6.0))
                        && called(c, "walkback_check", |_| true))
            },
        },
        Q {
            text: "同じ坂の練習コースを北海道で探して",
            ok: |c| {
                called(c, "walkback_check", |a| {
                    a["with_rehearsal"] == json!(true) || a["with_rehearsal"] == json!("true")
                })
            },
        },
        Q {
            text: "ローバーが壊れたらどこで引き返す？",
            ok: |c| called(c, "rover_walkback", |_| true),
        },
        Q {
            text: "根拠を見せて",
            ok: |c| called(c, "open_evidence", |a| a["topic"].is_string()),
        },
        Q {
            text: "8時間を超えた船外活動は何回？",
            ok: |c| {
                called(c, "query_nasa", |a| {
                    let q = a["sql"].as_str().unwrap_or("").to_lowercase();
                    q.contains("eva") && q.contains('8') && q.contains("count")
                })
            },
        },
        Q {
            text: "sol 1000 までに Perseverance は何 km 走った？",
            ok: |c| {
                called(c, "query_nasa", |a| {
                    let q = a["sql"].as_str().unwrap_or("").to_lowercase();
                    q.contains("rover_traverse") && q.contains("1000") && q.contains("km")
                })
            },
        },
        Q {
            text: "いちばん長い船外活動は何時間で、だれが行った？",
            ok: |c| {
                called(c, "query_nasa", |a| {
                    let q = a["sql"].as_str().unwrap_or("").to_lowercase();
                    q.contains("eva") && (q.contains("max") || q.contains("order by"))
                })
            },
        },
    ];

    /// Numbers written in `s` ("6.1", "1359", "72"), as text with a trailing ".0" removed.
    fn numbers(s: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut cur = String::new();
        let flush = |cur: &mut String, out: &mut Vec<String>| {
            let t = cur.trim_end_matches('.').to_string();
            if !t.is_empty() {
                out.push(t.strip_suffix(".0").map(str::to_string).unwrap_or(t));
            }
            cur.clear();
        };
        for ch in s.chars() {
            let ch = match ch {
                '０'..='９' => char::from_u32(ch as u32 - 0xFEE0).unwrap(),
                '．' => '.',
                c => c,
            };
            if ch.is_ascii_digit() || (ch == '.' && !cur.is_empty() && !cur.contains('.')) {
                cur.push(ch);
            } else {
                flush(&mut cur, &mut out);
            }
        }
        flush(&mut cur, &mut out);
        out
    }

    #[derive(Debug)]
    struct Run {
        first_s: Option<f64>,
        total_s: f64,
        tool_ok: bool,
        nums_ok: bool,
        answer: String,
        calls: Vec<(String, Value)>,
        bad: Vec<String>,
    }

    #[test]
    #[ignore]
    fn bench() {
        use std::io::{BufRead, BufReader, Write};
        use std::process::{Command, Stdio};
        use std::time::Instant;
        let bridge = std::env::var("BENCH_BRIDGE")
            .unwrap_or_else(|_| "node scripts/agent-bench/bridge.mjs".into());
        let models: Vec<String> = std::env::var("BENCH_MODELS")
            .unwrap_or_else(|_| "qwen2.5:7b".into())
            .split(',')
            .map(str::to_string)
            .collect();
        let runs: usize = std::env::var("BENCH_RUNS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5);
        let prompt = if std::env::var("BENCH_PROMPT").as_deref() == Ok("original") {
            BENCH_SYSTEM_PROMPT_ORIGINAL
        } else {
            SYSTEM_PROMPT
        };
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(&bridge)
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("bridge");
        let stdin = Arc::new(StdMutex::new(child.stdin.take().unwrap()));
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let first: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        let specs: Vec<ToolSpec> = serde_json::from_value(first["tools"].clone()).unwrap();
        // Bridge replies → whichever AgentState is current.
        let current: Arc<StdMutex<Option<Arc<AgentState>>>> = Arc::default();
        let outputs: Arc<StdMutex<Vec<String>>> = Arc::default();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();
        {
            let (current, outputs) = (current.clone(), outputs.clone());
            std::thread::spawn(move || {
                for line in lines {
                    let v: Value = match line.ok().and_then(|l| serde_json::from_str(&l).ok()) {
                        Some(v) => v,
                        None => continue,
                    };
                    if v["type"] == "ready" {
                        let _ = ready_tx.send(());
                        continue;
                    }
                    let out = v["output"].as_str().unwrap_or("").to_string();
                    outputs.lock().unwrap().push(out.clone());
                    if let Some(st) = current.lock().unwrap().clone() {
                        st.tool_result(
                            v["id"].as_str().unwrap_or(""),
                            ToolReply {
                                ok: v["ok"] == json!(true),
                                output: out,
                                details: v["details"].clone(),
                            },
                        );
                    }
                }
            });
        }
        let rt = tokio::runtime::Runtime::new().unwrap();
        let mut report = String::from("| model | question | first text s (median / max) | done s (median / max) | right tool+args | numbers match |\n|---|---|---|---|---|---|\n");
        for m in &models {
            let only: Option<Vec<usize>> = std::env::var("BENCH_Q")
                .ok()
                .map(|v| v.split(',').filter_map(|x| x.trim().parse().ok()).collect());
            for (qi, q) in QUESTIONS.iter().enumerate() {
                if only.as_ref().is_some_and(|o| !o.contains(&(qi + 1))) {
                    continue;
                }
                let mut rs: Vec<Run> = Vec::new();
                for _ in 0..runs {
                    writeln!(stdin.lock().unwrap(), "{}", json!({"type":"reset"})).unwrap();
                    ready_rx.recv().unwrap();
                    outputs.lock().unwrap().clear();
                    let state = Arc::new(AgentState::default());
                    *current.lock().unwrap() = Some(state.clone());
                    let calls: Arc<StdMutex<Vec<(String, Value)>>> = Arc::default();
                    let first_text: Arc<StdMutex<Option<Instant>>> = Arc::default();
                    let (c2, f2, si) = (calls.clone(), first_text.clone(), stdin.clone());
                    let emit: Emit = Arc::new(move |e: &str, v: Value| {
                        if e == "agent-tool-call" {
                            c2.lock()
                                .unwrap()
                                .push((v["name"].as_str().unwrap_or("").into(), v["args"].clone()));
                            writeln!(si.lock().unwrap(), "{v}").map_err(|e| e.to_string())?;
                        } else if e == "agent-event" && v["type"] == "text" {
                            f2.lock().unwrap().get_or_insert_with(Instant::now);
                        }
                        Ok(())
                    });
                    let model: Arc<dyn Model> =
                        Arc::new(pi_rs::ollama::Ollama::new(OLLAMA_URL, None).unwrap());
                    let t0 = Instant::now();
                    let answer = rt.block_on(async {
                        state
                            .start_with_prompt(
                                specs.clone(),
                                model,
                                ModelInfo {
                                    provider: "ollama",
                                    model: m.clone(),
                                },
                                emit,
                                prompt,
                            )
                            .unwrap();
                        tokio::time::timeout(Duration::from_secs(240), state.prompt(q.text.into()))
                            .await
                    });
                    let total_s = t0.elapsed().as_secs_f64();
                    let answer = match answer {
                        Ok(Ok(a)) => a,
                        Ok(Err(e)) => format!("ERROR {e}"),
                        Err(_) => "TIMEOUT".into(),
                    };
                    let calls = calls.lock().unwrap().clone();
                    let tool_text = outputs.lock().unwrap().join("\n");
                    let have: std::collections::HashSet<String> = numbers(&tool_text)
                        .into_iter()
                        .chain(numbers(q.text))
                        .collect();
                    let bad: Vec<String> = numbers(&answer)
                        .into_iter()
                        .filter(|n| !have.contains(n))
                        .collect();
                    let first_s = first_text
                        .lock()
                        .unwrap()
                        .map(|t| t.duration_since(t0).as_secs_f64());
                    let tool_ok = (q.ok)(&calls);
                    let nums_ok = tool_ok
                        && !answer.starts_with("ERROR")
                        && answer != "TIMEOUT"
                        && bad.is_empty()
                        && !numbers(&answer).is_empty();
                    eprintln!("[{m}] {} {:.1}s tool={tool_ok} nums={nums_ok} calls={:?} bad={bad:?}\n  → {}", q.text, total_s, calls, answer.replace('\n', " "));
                    rs.push(Run {
                        first_s,
                        total_s,
                        tool_ok,
                        nums_ok,
                        answer,
                        calls,
                        bad,
                    });
                }
                let stat = |mut v: Vec<f64>| -> String {
                    if v.is_empty() {
                        return "–".into();
                    }
                    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
                    format!("{:.1} / {:.1}", v[v.len() / 2], v[v.len() - 1])
                };
                report += &format!(
                    "| {m} | {} | {} | {} | {}/{runs} | {}/{runs} |\n",
                    q.text,
                    stat(rs.iter().filter_map(|r| r.first_s).collect()),
                    stat(rs.iter().map(|r| r.total_s).collect()),
                    rs.iter().filter(|r| r.tool_ok).count(),
                    rs.iter().filter(|r| r.nums_ok).count()
                );
                let _ = (&rs[0].answer, &rs[0].calls, &rs[0].bad);
            }
        }
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        println!(
            "\nprompt: {}\n{report}",
            if prompt == SYSTEM_PROMPT {
                "default"
            } else {
                "original"
            }
        );
        let out = std::env::var("BENCH_OUT").unwrap_or_else(|_| "/dev/null".into());
        let _ = std::fs::write(out, &report);
    }
}
