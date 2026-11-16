import { afterEach, describe, expect, it, vi } from 'vitest';

const saved: Record<string, string> = {};
vi.mock('../settings', () => ({
  getSettings: () => ({ cloudVia: 'openai', openaiKey: 'sk-test', openaiModel: 'gpt-6.1-terra' }),
  setSetting: (k: string, v: string) => { saved[k] = v; },
}));
import { chatModels, openaiTurn } from './openai';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI model fallback', () => {
  it('ranks chat models and drops non-chat ones', () => {
    expect(chatModels(['text-embedding-3-small', 'gpt-6.1-terra', 'gpt-4o', 'gpt-5-mini', 'gpt-5-2025-08-07', 'gpt-5', 'gpt-4o-realtime-preview', 'gpt-4.1', 'gpt-image-1']))
      .toEqual(['gpt-6.1-terra', 'gpt-5', 'gpt-5-2025-08-07', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o']);
  });
  it('on 404 reads /v1/models, saves an available model and retries once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'The model `gpt-6.1-terra` does not exist', code: 'model_not_found' } }, 404))
      .mockResolvedValueOnce(json({ data: [{ id: 'whisper-1' }, { id: 'gpt-4o' }, { id: 'gpt-5-mini' }, { id: 'gpt-5' }] }))
      .mockResolvedValueOnce(json({ model: 'gpt-5', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await openaiTurn([{ role: 'user', content: 'q' }], []);
    expect(r.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/models');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).model).toBe('gpt-5');
    expect(saved.openaiModel).toBe('gpt-5');
  });
  it('says what to do when no model list can be read', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'nope' } }, 404))
      .mockResolvedValueOnce(json({ error: {} }, 403)));
    await expect(openaiTurn([{ role: 'user', content: 'q' }], [])).rejects.toThrow(/設定画面でモデル名/);
  });
  it('sends reasoning_effort none, and on a 400 about it retries once without it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model.", code: 'unsupported_value' } }, 400))
      .mockResolvedValueOnce(json({ model: 'gpt-4o', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await openaiTurn([{ role: 'user', content: 'q' }], [{ name: 't', description: 'd', input_schema: { type: 'object' } }]);
    expect(r.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('none');
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second).not.toHaveProperty('reasoning_effort');
    expect(second.tools).toHaveLength(1);
    expect(second.model).toBe('gpt-6.1-terra');
  });
});
