import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTool } from './port';
import { claudeAgent, resetClaude } from './claude';
import { NoModelError } from './pirs';
import type { AgentEvent, ToolDef } from './types';
// @ts-expect-error plain JS worker, no types
import worker from '../../public/_worker.js';

const tool: ToolDef = {
  name: 'walkback_check', description: 'Can the crew walk back?', parameters: { type: 'object' }, kind: 'compute',
  run: async () => ({ text: '帰れます。往復 6.0 km、酸素の余裕 2.1 時間。', sources: [{ label: 'NASA EVA' }] }),
};
registerTool(tool);

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); resetClaude(); });

describe('claude agent (browser tool loop)', () => {
  it('runs the tool the model asks for and passes the result back', async () => {
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push(body);
      return sent.length === 1
        ? reply({ model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'tu1', name: 'walkback_check', input: { route: { away_km: 3 } } }] })
        : reply({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '帰れます（往復 6.0 km）。出典: NASA EVA' }] });
    }));
    const events: AgentEvent[] = [];
    await claudeAgent.ask('3km先から帰れる？', [tool], (e) => events.push(e));
    expect(sent).toHaveLength(2);
    expect(sent[0].tools[0]).toMatchObject({ name: 'walkback_check', input_schema: { type: 'object' } });
    // The assistant turn goes back unchanged (thinking block included), then the tool result.
    expect(sent[1].messages[1].content[0].type).toBe('thinking');
    expect(sent[1].messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' });
    expect(sent[1].messages[2].content[0].content).toContain('6.0 km');
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'text', 'done']);
  });

  it('throws NoModelError when the deployment has no key (the panel then uses rules)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'not_configured' }, 503)));
    await expect(claudeAgent.ask('q', [tool], () => undefined)).rejects.toBeInstanceOf(NoModelError);
  });
});

describe('relay worker', () => {
  const post = (body: unknown, origin = 'https://walkback.example') =>
    new Request('https://walkback.example/api/agent', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

  it('fixes the model and system prompt and sends the key only to Anthropic', async () => {
    let seen: { url: string; headers: Record<string, string>; body: any } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return reply({ stop_reason: 'end_turn', content: [] });
    }));
    const res = await worker.fetch(post({ model: 'other', system: 'evil', messages: [{ role: 'user', content: 'hi' }], tools: [] }), { ANTHROPIC_API_KEY: 'k' });
    expect(res.status).toBe(200);
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen!.headers['x-api-key']).toBe('k');
    expect(seen!.body.model).toBe('claude-opus-5-5');
    expect(seen!.body.system).toContain('数字の決まり');
    expect(await res.text()).not.toContain('"k"');
  });

  it('reports availability, refuses other sites and missing keys', async () => {
    const get = new Request('https://walkback.example/api/agent');
    expect(await (await worker.fetch(get, {})).json()).toEqual({ available: false, model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], via: null });
    expect((await worker.fetch(post({ messages: [{ role: 'user', content: 'hi' }] }), {})).status).toBe(503);
    expect((await worker.fetch(post({ messages: [{ role: 'user', content: 'hi' }] }, 'https://evil.example'), { ANTHROPIC_API_KEY: 'k' })).status).toBe(403);
  });
});

describe('relay worker via the tachyon AI gateway', () => {
  it('translates to chat completions and back', async () => {
    let sent: any = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent = { url, headers: init.headers, body: JSON.parse(init.body as string) };
      return reply({ model: 'anthropic:claude-opus-5-5', choices: [{ message: { role: 'assistant', content: '確認します。', tool_calls: [{ id: 't2', type: 'function', function: { name: 'walkback_check', arguments: '{"route":{"away_km":3}}' } }] }, finish_reason: 'tool_calls' }] });
    }));
    const req = new Request('https://w.example/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      messages: [
        { role: 'user', content: '3km?' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 't1', name: 'walkback_check', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '帰れます' }] },
      ],
      tools: [{ name: 'walkback_check', description: 'd', input_schema: { type: 'object' } }],
    }) });
    const out = await (await worker.fetch(req, { TACHYON_API_KEY: 'tk' })).json();
    expect(sent.url).toContain('/v1/llms/chat/completions');
    expect(sent.headers.authorization).toBe('Bearer tk');
    expect(sent.body.model).toBe('anthropic/claude-opus-5-5');
    expect(sent.body.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(sent.body.messages[2].tool_calls[0].function.name).toBe('walkback_check');
    expect(sent.body.tools[0].function.parameters).toEqual({ type: 'object' });
    expect(out.stop_reason).toBe('tool_use');
    expect(out.content).toEqual([{ type: 'text', text: '確認します。' }, { type: 'tool_use', id: 't2', name: 'walkback_check', input: { route: { away_km: 3 } } }]);
  });
});

import { keepAskedNumbers } from './pirsWeb';
describe('in-browser pi-rs argument guard', () => {
  it('keeps only the numbers the question said', () => {
    expect(keepAskedNumbers({ speed_kmh: '5', o2_h: 6, route: { away_km: 3 }, lang: 'ja' }, '酸素6時間で3km先から帰れる？'))
      .toEqual({ o2_h: 6, route: { away_km: 3 }, lang: 'ja' });
    expect(keepAskedNumbers({ o2_h: 12 }, 'ローバーが壊れたら？')).toEqual({});
  });
});

import { pickModel } from './pirsWeb';
describe('in-browser model per device', () => {
  const pc = { webgpu: true, f16: true, mobile: false, memoryGB: 8, maxBufferGB: 4 };
  it('4B on a capable computer, 1.7B on phones and small machines, none without WebGPU', () => {
    expect(pickModel(pc)).toBe('4b');
    expect(pickModel({ ...pc, memoryGB: undefined })).toBe('4b');
    expect(pickModel({ ...pc, mobile: true })).toBe('1.7b');
    expect(pickModel({ ...pc, memoryGB: 4 })).toBe('1.7b');
    expect(pickModel({ ...pc, maxBufferGB: 0.25 })).toBe('1.7b');
    expect(pickModel({ ...pc, f16: false })).toBeNull();
    expect(pickModel({ ...pc, webgpu: false })).toBeNull();
    expect(pickModel({ ...pc, webgpu: false, override: '8b' })).toBe('8b');
  });
});
