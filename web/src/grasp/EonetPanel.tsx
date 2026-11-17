// world-grasp 地球タブ: NASA EONET の進行中イベント一覧 (情報表示のみ)。
// ライブ取得できなければ同梱サンプルに切り替わり、見出しにモードを表示する。
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { loadEonet, type EonetResult } from './eonet';

export function EonetPanel() {
  const t = useT();
  const [res, setRes] = useState<EonetResult | null>(null);

  useEffect(() => {
    let on = true;
    loadEonet().then((r) => { if (on) setRes(r); }).catch(() => undefined);
    return () => { on = false; };
  }, []);

  return (
    <div className="card grasp-eonet">
      <h4>🌐 NASA EONET — {t('進行中の自然イベント', 'Ongoing natural events')}
        {res && (
          <span className="grasp-chip" style={res.live
            ? { borderColor: '#52c41a', color: '#52c41a' }
            : { borderColor: '#faad14', color: '#faad14' }}>
            {res.live ? t('ライブ', 'LIVE') : t('サンプル', 'SAMPLE')}
          </span>
        )}
      </h4>
      {!res ? (
        <p className="muted">{t('EONET を読み込み中…', 'Loading EONET…')}</p>
      ) : (
        <ul>
          {res.events.slice(0, 8).map((e) => (
            <li key={e.id}>
              <span className="grasp-eonet-cat">{e.category}</span>
              <a href={e.link} target="_blank" rel="noreferrer">{e.title}</a>
              {e.date && <span className="muted grasp-eonet-date"> · {e.date.slice(0, 10)}</span>}
              {e.sourceUrl && (
                <span className="muted"> （<a href={e.sourceUrl} target="_blank" rel="noreferrer">{t('出典', 'source')}</a>）</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">{t('情報表示のみで、ユニットの判定には影響しません。取得できない環境では同梱サンプルを表示します。', 'Information only — it never affects unit verdicts. Where the API cannot be reached, a bundled sample is shown instead.')}</p>
    </div>
  );
}
