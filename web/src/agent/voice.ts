// Voice questions. Desktop app: record the mic, encode 16 kHz mono WAV and transcribe it offline
// with whisper.cpp (src-tauri/src/voice.rs). Browser: the Web Speech API where the browser has one.
// Either way the transcript goes into the question panel, so the asker sees what was heard.
import type { Lang } from '../i18n';

interface TauriInternals { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> }
const tauri = () => (typeof window !== 'undefined' ? (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__ : undefined);

type SpeechCtor = new () => {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
};
const speechCtor = (): SpeechCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export interface VoiceStatus { mode: 'whisper' | 'browser' | 'none'; detail?: string }

export async function voiceStatus(): Promise<VoiceStatus> {
  const t = tauri();
  if (t) {
    try {
      const s = await t.invoke<{ ok: boolean; cli?: string; model?: string; error?: string }>('voice_status');
      return s.ok ? { mode: 'whisper', detail: s.model } : { mode: 'none', detail: s.error };
    } catch (e) { return { mode: 'none', detail: String(e) }; }
  }
  if (typeof window !== 'undefined' && speechCtor() && navigator.mediaDevices) return { mode: 'browser' };
  return { mode: 'none' };
}

/** 16-bit PCM mono WAV. */
function wav(samples: Float32Array, rate: number): Uint8Array {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true);
  b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data');
  b.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(b.buffer);
}

/** Average down to 16 kHz (whisper's rate). */
function to16k(x: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return x;
  const k = rate / 16000, out = new Float32Array(Math.floor(x.length / k));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * k), b = Math.min(x.length, Math.floor((i + 1) * k));
    let s = 0; for (let j = a; j < b; j++) s += x[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

export interface Recording { stop(): Promise<string>; cancel(): void }

/** Start listening. stop() resolves with the transcript (it also stops by itself after maxMs). */
export async function startVoice(lang: Lang, maxMs = 15000): Promise<Recording> {
  const t = tauri();
  if (!t) {
    const Ctor = speechCtor();
    if (!Ctor) throw new Error('no-voice');
    const rec = new Ctor();
    rec.lang = lang === 'ja' ? 'ja-JP' : 'en-US';
    rec.interimResults = false; rec.maxAlternatives = 1;
    let text = '', fail: string | null = null, ended!: () => void;
    const done = new Promise<void>((r) => { ended = r; });
    rec.onresult = (e) => { text = Array.from(e.results).map((r) => r[0].transcript).join(' '); };
    rec.onerror = (e) => { fail = e.error; };
    rec.onend = () => ended();
    rec.start();
    const timer = setTimeout(() => rec.stop(), maxMs);
    return {
      async stop() { rec.stop(); await done; clearTimeout(timer); if (fail && !text) throw new Error(fail); return text.trim(); },
      cancel() { clearTimeout(timer); rec.stop(); },
    };
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc); proc.connect(ctx.destination);
  const close = () => { proc.disconnect(); src.disconnect(); stream.getTracks().forEach((x) => x.stop()); ctx.close().catch(() => undefined); };
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  const finish = async () => {
    if (stopped) return '';
    stopped = true; clearTimeout(timer); close();
    const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const bytes = wav(to16k(all, ctx.sampleRate), 16000);
    const text = await t.invoke<string>('voice_transcribe', { wav: Array.from(bytes), lang });
    return text.trim();
  };
  let autoStop: Promise<string> | null = null;
  timer = setTimeout(() => { autoStop = finish(); }, maxMs);
  return { stop: () => autoStop ?? finish(), cancel() { stopped = true; clearTimeout(timer); close(); } };
}
