import { describe, expect, it } from 'vitest';
import { SYSTEM, fromOpenAI, toOpenAI } from './openai';
// @ts-expect-error plain JS worker, no types
import { SYSTEM as WORKER_SYSTEM } from '../../public/_worker.js';

describe('own OpenAI key', () => {
  it('uses the same system prompt as the relay', () => {
    expect(SYSTEM).toBe(WORKER_SYSTEM);
  });
  it('round-trips a tool call', () => {
    const msgs = toOpenAI('sys', [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'walkback_check', input: { o2_h: 6 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    ]);
    expect(msgs).toHaveLength(4);
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'ok' });
    const r = fromOpenAI({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'x', function: { name: 'walkback_check', arguments: '{"o2_h":6}' } }] } }] });
    expect(r.stop_reason).toBe('tool_use');
    expect(r.content[0]).toEqual({ type: 'tool_use', id: 'x', name: 'walkback_check', input: { o2_h: 6 } });
  });
});
