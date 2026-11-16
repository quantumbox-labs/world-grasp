// Question panel: a dock on every tab. Pick an agent (rules / pi-rs), ask, and see each tool call as
// a chip (name, arguments, sources, SQL). Answers only quote tool results.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAgent, getTools, listAgents, onRegistryChange, toolsReady } from './port';
import { NoModelError, lastModel } from './pirs';
import { claudeModel } from './claude';
import type { AgentEvent, ToolResult } from './types';
import { useLang, useT } from '../i18n';
import { currentWalkController } from '../walk/controller';
import { publishAnswer } from './lastAnswer';
import { setSetting, useSettings, type AiChoice } from '../settings';
import { startVoice, voiceStatus, type Recording, type VoiceStatus } from './voice';

export const EXAMPLES = [
  '2月に氷の試験をしたい',
  '歩く訓練をしたい',
  'ローバーが壊れたら？',
  '基地から3km先まで歩いて帰れる？',
  '同じ坂の練習コースを北海道で探して',
  'この訓練、北海道のどこでいつやる？',
  '根拠を見せて',
  '3Dで歩いて見せて',
  '有人ローバーが壊れたら歩いて帰れる？',
  '歩いた記録で火星を歩いて見せて',
];
export const EXAMPLES_EN = [
  'An ice test in February',
  'I want walking training',
  'What if the rover breaks down?',
  'Can I walk back from 3 km out?',
  'Find a practice course in Hokkaido with the same slopes',
  'Where and when in Hokkaido should we train?',
  'Show me the evidence',
  'Show the walk in 3D',
  'If the crewed rover breaks down, can we walk back?',
  'Replay our recorded walk on Mars',
];

interface Call { id: string; name: string; args: unknown; result?: ToolResult; ok?: boolean }
type Item =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; agent: string; text: string; calls: Call[]; error?: string; note?: string; status?: string; done: boolean };

/** Plain names for the tools shown under an answer (no function identifiers on screen). */
const TOOL_JA: Record<string, [string, string]> = {
  walkback_check: ['帰れるか判定', 'Walk-back check'], plan_route: ['経路探索', 'Route search'], evaluate_route: ['経路の評価', 'Route evaluation'],
  rover_walkback: ['ローバー故障', 'Rover breakdown'], query_nasa: ['NASA データを調べる', 'NASA data lookup'], list_nasa_tables: ['NASA データの表一覧', 'NASA data tables'], summarize_nasa: ['NASA データの集計', 'NASA data summary'], compare_nasa: ['NASA データの比較', 'NASA data comparison'], open_evidence: ['根拠', 'Evidence'],
  import_walk: ['歩いた記録', 'Recorded walk'], mars_replay: ['火星で再生', 'Replay on Mars'], view_3d: ['3D 表示', '3D view'], view_globe: ['全球', 'Globe'],
  view_overlay: ['地図の層', 'Map layer'], view_set_params: ['条件を変える', 'Settings'], view_walk: ['ヘルメットで歩く', 'Helmet walk'],
  explore_hokkaido: ['北海道の候補地', 'Hokkaido places'], view_scan: ['北海道の地図', 'Hokkaido map'],
};
function Chip({ c }: { c: Call }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const tool = getTools().find((t) => t.name === c.name);
  const state = c.ok == null ? 'run' : c.ok ? 'ok' : 'ng';
  return (
    <div className={`tool-chip ${state}`} data-tool={c.name}>
      <button className="tool-chip-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-kind">{tool?.kind === 'view' ? t('表示', 'view') : t('計算', 'compute')}</span>
        <span className="tool-name">{TOOL_JA[c.name]?.[lang === 'ja' ? 0 : 1] ?? c.name}</span>
        <span className="tool-state">{state === 'run' ? (c.name === 'explore_hokkaido' ? t('北海道を探索中…（初回は数秒）', 'Exploring Hokkaido… (a few seconds the first time)') : t('計算中…', 'Computing…')) : state === 'ok' ? '✓' : '✕'}</span>
      </button>
      {open && (
        <div className="tool-chip-body">
          <div className="muted">{t('引数', 'Arguments')}</div>
          <pre>{JSON.stringify(c.args ?? {}, null, 1)}</pre>
          {c.result && <><div className="muted">{t('結果', 'Result')}</div><p>{c.result.text}</p></>}
          {c.result?.sources?.length ? (
            <><div className="muted">{t('出典', 'Sources')}</div>
              <ul>{c.result.sources.map((s) => <li key={s.label}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}</li>)}</ul></>
          ) : null}
          {c.result?.sql && <><div className="muted">SQL</div><pre>{c.result.sql}</pre></>}
        </div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const t = useT();
  const lang = useLang();
  const [, bump] = useState(0);
  useEffect(() => onRegistryChange(() => bump((n) => n + 1)), []);
  const [avail, setAvail] = useState<Record<string, boolean>>({});
  const agents = listAgents();
  const settings = useSettings();
  const ownKey = settings.cloudVia === 'openai' && !!settings.openaiKey.trim();
  useEffect(() => {
    let live = true;
    Promise.all(agents.map(async (a) => [a.id, await a.available()] as const)).then((r) => live && setAvail(Object.fromEntries(r)));
    return () => { live = false; };
  }, [agents.length, ownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The AI picked here or on the settings screen (one setting, remembered).
  const { ai } = settings;
  // Automatic: desktop pi-rs; web: Claude through our relay when the deployment has a key; otherwise rules.
  const auto = avail['pi-rs'] ? 'pi-rs' : avail['claude'] ? 'claude' : 'rules';
  const inApp = avail['pi-rs'] ? 'pi-rs' : avail['pi-rs-web'] ? 'pi-rs-web' : null;
  const chosen = ai === 'rules' ? 'rules' : ai === 'in-app' ? inApp ?? auto : ai === 'claude' && avail['claude'] !== false ? 'claude' : auto;
  const setAgentId = (id: string) => setSetting('ai', (id === 'pi-rs' || id === 'pi-rs-web' ? 'in-app' : id) as AiChoice);

  // Open by default on WALKBACK; elsewhere a small button, so it never covers the other tabs.
  const isWalk = () => /^#(walk|mars)/.test(location.hash) || location.hash.replace('#', '') === '';
  // Phones start with the small button so the map stays usable.
  const narrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 820px)').matches;
  const [open, setOpen] = useState(() => isWalk() && !narrow());
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  // Suggestions: hidden once a question is asked; back when the last answer came out empty, or on request.
  const [examplesOpen, setExamplesOpen] = useState(false);
  const lastItem = items[items.length - 1];
  const emptyAnswer = !!lastItem && lastItem.kind === 'agent' && lastItem.done && !lastItem.text && !lastItem.calls.length;
  const showExamples = examplesOpen || !items.some((x) => x.kind === 'user') || emptyAnswer;
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // A card that should come to the front (the same-slope challenge) folds the panel away, unless
  // the panel was just used (its answer is what the person is reading).
  const lastUse = useRef(0);
  useEffect(() => {
    const onFront = () => { if (Date.now() - lastUse.current > 4000) setOpen(false); };
    window.addEventListener('walkback:front', onFront);
    return () => window.removeEventListener('walkback:front', onFront);
  }, []);
  const answerText = useRef('');
  // Voice: whisper.cpp in the desktop app, the browser's speech recognition on the web.
  const [voice, setVoice] = useState<VoiceStatus>({ mode: 'none' });
  const [listening, setListening] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  useEffect(() => { voiceStatus().then(setVoice).catch(() => undefined); }, []);
  const toggleVoice = async () => {
    setVoiceErr(null);
    if (!rec.current) {
      try { rec.current = await startVoice(lang); setListening(true); }
      catch (e) { setVoiceErr(t('マイクを使えませんでした。マイクの使用を許可してから、もう一度押してください。', 'Could not use the microphone. Allow microphone access and press again.')); console.warn(e); }
      return;
    }
    const r = rec.current; rec.current = null; setListening(false);
    try {
      const text = await r.stop();
      if (!text) { setVoiceErr(t('声が聞き取れませんでした。もう少し大きな声で、もう一度どうぞ。', 'Nothing was heard. Speak a little louder and try again.')); return; }
      setQ(text);
      ask(text);
    } catch (e) {
      setVoiceErr(t('文字起こしに失敗しました。文字で質問するか、もう一度押してください。', 'Transcription failed. Type the question or press again.'));
      console.warn(e);
    }
  };
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [items]);
  const used = items.length > 0 || busy;
  useEffect(() => {
    const on = () => { if (!used) setOpen(isWalk() && !narrow()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [used]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchLast = (f: (it: Extract<Item, { kind: 'agent' }>) => Extract<Item, { kind: 'agent' }>) =>
    setItems((xs) => {
      const i = xs.length - 1, last = xs[i];
      return last?.kind === 'agent' ? [...xs.slice(0, i), f(last)] : xs;
    });

  const onEvent = (e: AgentEvent) => {
    if (e.type === 'text') { answerText.current += e.text; patchLast((it) => ({ ...it, text: it.text + e.text })); }
    else if (e.type === 'tool_call') patchLast((it) => ({ ...it, calls: [...it.calls, { id: e.id, name: e.name, args: e.args }] }));
    else if (e.type === 'tool_result') patchLast((it) => ({ ...it, calls: it.calls.map((c) => (c.id === e.id ? { ...c, result: e.result, ok: e.ok } : c)) }));
    else if (e.type === 'error') patchLast((it) => ({ ...it, error: e.message }));
    else if (e.type === 'status') patchLast((it) => ({ ...it, status: e.text || undefined }));
    else if (e.type === 'done') patchLast((it) => ({ ...it, done: true }));
  };

  const ask = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setQ('');
    setExamplesOpen(false);
    setBusy(true);
    lastUse.current = Date.now() + 600000; // busy: never fold mid-answer
    answerText.current = '';
    const ctl = new AbortController();
    abort.current = ctl;
    let agent = getAgent(chosen) ?? getAgent('rules')!;
    setItems((xs) => [...xs, { kind: 'user', text: prompt }, { kind: 'agent', agent: agent.id, text: '', calls: [], done: false }]);
    // The lazily loaded tools may still be on their way right after the page opens.
    await Promise.race([toolsReady(), new Promise((r) => setTimeout(r, 8000))]);
    try {
      try {
        await agent.ask(prompt, getTools(), onEvent, ctl.signal);
      } catch (e) {
        if (!(e instanceof NoModelError) || agent.id === 'rules') throw e;
        // No model reachable: say so and answer with the rules version.
        agent = getAgent('rules')!;
        console.warn('agent fallback', e.message);
        patchLast((it) => ({ ...it, agent: 'rules', note: t('AI に接続できないため、QA で答えます', 'The AI is not reachable, so QA answers') }));
        await agent.ask(prompt, getTools(), onEvent, ctl.signal);
      }
      // (Model names are not shown on screen.)
      if (agent.id === 'claude' && claudeModel) console.debug('[agent] model', claudeModel);
      if (agent.id === 'pi-rs' && lastModel) console.debug('[agent] model', lastModel.provider, lastModel.model);
    } catch (e) {
      onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      patchLast((it) => ({ ...it, done: true }));
      if (answerText.current) publishAnswer({ q: prompt, a: answerText.current, at: Date.now(), cond: currentWalkController()?.params() });
      setBusy(false);
      lastUse.current = Date.now();
      abort.current = null;
    }
  };

  const label = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.label])), [agents]);

  if (!open) return <button className="agent-fab" onClick={() => setOpen(true)} aria-label={t('質問欄を開く', 'Open the question panel')}>💬 {t('質問する', 'Ask')}</button>;
  return (
    <section className="agent-panel" aria-label={t('質問欄', 'Question panel')}>
      <div className="agent-head">
        <b>{t('質問する', 'Ask WALKBACK')}</b>
        <select aria-label={t('エージェント', 'Agent')} value={chosen} onChange={(e) => setAgentId(e.target.value)}>
          {/* One "In-app AI" entry: hide the desktop one where it cannot run but the browser one can. */}
          {agents.filter((a) => !(a.id === 'pi-rs' && avail['pi-rs'] === false && avail['pi-rs-web']) && !(a.id === 'pi-rs-web' && !avail['pi-rs-web'])).map((a) => (
            <option key={a.id} value={a.id} disabled={avail[a.id] === false}>
              {a.label}{avail[a.id] === false ? (a.id === 'claude' ? t('（未設定）', ' (not set up)') : t('（デスクトップ版のみ）', ' (desktop app only)')) : ''}
            </option>
          ))}
        </select>
        <button className="agent-close" onClick={() => setOpen(false)} aria-label={t('質問欄を閉じる', 'Close the question panel')}>—</button>
      </div>
      <div className="agent-log" ref={logRef}>
        {items.length === 0 && <p className="muted">{t('数字はすべて NASA のデータから計算しています。下の例を押すか、質問を書いてください。', 'Every number is calculated from NASA data. Tap an example below or type a question.')}</p>}
        {items.map((it, i) => it.kind === 'user'
          ? <div key={i} className="msg user">{it.text}</div>
          : (
            <div key={i} className="msg agent" data-done={it.done ? '1' : '0'}>
              <div className="msg-who">{label[it.agent] ?? it.agent}{it.note ? ` · ${it.note}` : ''}</div>
              {it.calls.map((c) => <Chip key={c.id} c={c} />)}
              {it.text && <div className="msg-text">{it.text}</div>}
              {!it.done && it.status && <div className="muted">{it.status}</div>}
              {!it.done && !it.text && !it.status && <div className="muted">…</div>}
              {it.error && <div className="warn">{it.error}</div>}
            </div>
          ))}
      </div>
      {showExamples ? (
        <div className="agent-examples">
          {(lang === 'ja' ? EXAMPLES : EXAMPLES_EN).map((x) => <button key={x} disabled={busy} onClick={() => ask(x)}>{x}</button>)}
        </div>
      ) : (
        <button className="linkish agent-examples-show" onClick={() => setExamplesOpen(true)}>{t('質問の例', 'Example questions')}</button>
      )}
      {(listening || voiceErr) && <p className={listening ? 'voice-live' : 'warn voice-err'}>{listening ? t('聞き取り中… 話し終えたら ■ を押してください', 'Listening… press ■ when you finish') : voiceErr}</p>}
      <form className="agent-input" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input id="agent-q" aria-label={t('質問', 'Question')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('例: 酸素6時間で基地から3km先まで帰れる？', 'e.g. With 6 hours of oxygen, can I walk back from 3 km out?')} />
        {voice.mode !== 'none' && (
          <button type="button" className={`mic${listening ? ' on' : ''}`} onClick={toggleVoice} disabled={busy}
            aria-pressed={listening} aria-label={listening ? t('話し終えたら押す', 'Press when you finish speaking') : t('声で質問する', 'Ask by voice')}
            title={voice.mode === 'whisper' ? t('声で質問（端末内で文字起こし、通信なし）', 'Ask by voice (transcribed on this device, offline)') : t('声で質問', 'Ask by voice')}>
            {listening ? '■' : '🎤'}
          </button>
        )}
        {busy
          ? <button type="button" onClick={() => abort.current?.abort()}>{t('止める', 'Stop')}</button>
          : <button type="submit" className="primary" disabled={!q.trim()}>{t('聞く', 'Ask')}</button>}
      </form>
    </section>
  );
}
