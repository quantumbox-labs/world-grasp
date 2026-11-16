// Settings: which AI answers the question panel, and which model each AI uses.
// Kept small on purpose; model names appear only here, next to a plain description.
import { useEffect, useState } from 'react';
import { useLang, useT } from './i18n';
import { CLOUD_MODELS, IN_APP_MODELS, OPENAI_MODELS, setSetting, useSettings, type AiChoice, type InAppModel } from './settings';
import { getAgent } from './agent/port';
import { desktopModels } from './agent/pirs';
import { listOpenAIModels } from './agent/openai';
import { autoModel } from './agent/pirsWeb';

const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const SIZE_NAME: Record<string, [string, string]> = { '1.7b': ['軽い', 'Light'], '4b': ['標準', 'Standard'], '8b': ['高精度', 'Most accurate'], '0.6b': ['最小', 'Smallest'] };

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const s = useSettings();
  // Models this OpenAI key can use (falls back to the fixed list when they cannot be read).
  const [keyModels, setKeyModels] = useState<string[]>([]);
  useEffect(() => {
    if (s.cloudVia !== 'openai' || !s.openaiKey.trim()) { setKeyModels([]); return; }
    const ac = new AbortController();
    const id = setTimeout(() => { listOpenAIModels(s.openaiKey, ac.signal).then((m) => { if (!ac.signal.aborted) setKeyModels(m); }); }, 400);
    return () => { clearTimeout(id); ac.abort(); };
  }, [s.cloudVia, s.openaiKey]);
  const desktop = isDesktop();
  const ownKey = s.cloudVia === 'openai' && !!s.openaiKey.trim();
  const [avail, setAvail] = useState<{ inApp: boolean; cloud: boolean } | null>(null);
  const [local, setLocal] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    const ok = async (id: string) => !!(await Promise.resolve(getAgent(id)?.available()).catch(() => false));
    Promise.all([desktop ? ok('pi-rs') : ok('pi-rs-web'), ok('claude')]).then(([inApp, cloud]) => live && setAvail({ inApp, cloud }));
    if (desktop) desktopModels().then((m) => live && setLocal(m));
    return () => { live = false; };
  }, [desktop, ownKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choices: { id: AiChoice; label: string; note: string; off?: boolean }[] = [
    { id: 'auto', label: t('自動（おすすめ）', 'Automatic (recommended)'), note: desktop ? t('アプリ内AI、使えなければ QA', 'In-app AI, or QA when it is not available') : t('クラウドAI、使えなければ QA', 'Cloud AI, or QA when it is not available') },
    { id: 'rules', label: 'QA', note: t('決まった手順で答える。通信なし・すぐ答える', 'Answers by fixed steps. Offline and instant') },
    { id: 'in-app', label: t('アプリ内AI', 'In-app AI'), note: desktop ? t('この端末の中で動く。通信なし', 'Runs on this device. Offline') : t('ブラウザの中で動く。初回だけダウンロード', 'Runs in the browser. Downloads once'), off: avail ? !avail.inApp : false },
    { id: 'claude', label: t('クラウドAI', 'Cloud AI'), note: t('インターネット経由。いちばん賢い', 'Over the internet. The smartest'), off: avail ? !avail.cloud : false },
  ];
  const autoName = autoModel ? SIZE_NAME[autoModel]?.[lang === 'ja' ? 0 : 1] : null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings" role="dialog" aria-modal="true" aria-label={t('設定', 'Settings')} onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <b>{t('設定', 'Settings')}</b>
          <button className="agent-close" onClick={onClose} aria-label={t('閉じる', 'Close')}>✕</button>
        </div>

        <fieldset>
          <legend>{t('質問に答えるAI', 'AI that answers questions')}</legend>
          {choices.map((c) => (
            <label key={c.id} className={`settings-choice${c.off ? ' off' : ''}`}>
              <input type="radio" name="ai" value={c.id} checked={s.ai === c.id} disabled={c.off} onChange={() => setSetting('ai', c.id)} />
              <span><b>{c.label}</b><small>{c.off ? (c.id === 'claude' ? t('この公開先では未設定です', 'Not set up on this deployment') : t('この端末では使えません', 'Not available on this device')) : c.note}</small></span>
            </label>
          ))}
        </fieldset>

        {!desktop && (
          <label className="settings-row">
            <span>{t('アプリ内AIのモデル', 'In-app AI model')}</span>
            <select value={s.inAppModel} disabled={avail ? !avail.inApp : false} onChange={(e) => setSetting('inAppModel', e.target.value as InAppModel)}>
              {IN_APP_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{lang === 'ja' ? m.ja : m.en}{m.id === 'auto' && autoName ? ` → ${autoName}` : ''}</option>
              ))}
            </select>
            <small className="muted">{t('大きいほど賢く、ダウンロードとメモリが増えます。', 'Bigger is smarter but needs a bigger download and more memory.')}</small>
          </label>
        )}

        {desktop && (
          <label className="settings-row">
            <span>{t('アプリ内AIのモデル', 'In-app AI model')}</span>
            <select value={s.desktopModel} onChange={(e) => setSetting('desktopModel', e.target.value)}>
              <option value="">{t('自動', 'Automatic')}</option>
              {(local ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {local && !local.length && <small className="muted">{t('この端末に入っているモデルが見つかりません。', 'No model found on this device.')}</small>}
          </label>
        )}

        <label className="settings-row">
          <span>{t('クラウドAIの接続先', 'Cloud AI connection')}</span>
          <select value={s.cloudVia} onChange={(e) => setSetting('cloudVia', e.target.value as 'relay' | 'openai')}>
            <option value="relay">{t('このサイトのAI（標準）', "This site's AI (default)")}</option>
            <option value="openai">{t('OpenAI（自分のAPIキー）', 'OpenAI (your own API key)')}</option>
          </select>
        </label>

        {s.cloudVia === 'relay' ? (
          <label className="settings-row">
            <span>{t('クラウドAIのモデル', 'Cloud AI model')}</span>
            <select value={s.cloudModel} disabled={avail ? !avail.cloud : false} onChange={(e) => setSetting('cloudModel', e.target.value)}>
              {CLOUD_MODELS.map((m) => <option key={m.id} value={m.id}>{lang === 'ja' ? m.ja : m.en}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="settings-row">
              <span>{t('OpenAI の APIキー', 'OpenAI API key')}</span>
              <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-..." value={s.openaiKey} onChange={(e) => setSetting('openaiKey', e.target.value)} />
              <small className="muted">{t('キーはこのブラウザの中だけに保存し、OpenAI に直接送ります。このサイトのサーバーには送りません。', 'The key is kept in this browser only and sent straight to OpenAI, never to this site’s server.')}</small>
            </label>
            <label className="settings-row">
              <span>{t('OpenAI のモデル', 'OpenAI model')}</span>
              <input list="openai-models" spellCheck={false} value={s.openaiModel} onChange={(e) => setSetting('openaiModel', e.target.value)} />
              <datalist id="openai-models">{(keyModels.length ? keyModels : OPENAI_MODELS).map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            {s.openaiKey && <button className="linkish" onClick={() => setSetting('openaiKey', '')}>{t('キーを消す', 'Remove the key')}</button>}
          </>
        )}

        <p className="muted settings-foot">{t('どのAIでも、答えの数字は NASA データの計算結果だけを使います。変更は次の質問から使われます。', 'Whichever AI answers, the numbers come only from calculations on NASA data. Changes apply from the next question.')}</p>
      </section>
    </div>
  );
}
