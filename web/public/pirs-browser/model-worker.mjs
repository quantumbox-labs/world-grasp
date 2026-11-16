// WebGPU model worker for the in-browser pi-rs agent (local experiment). Adapted from pi-rs
// examples/browser-preview/browser-model-worker.mjs (quantum-box/pi-rs#238): Qwen3 in the
// browser, 0.6B through Transformers.js or 1.7B through WebLLM. It only turns the pi-rs
// ModelRequest messages into text and parses <tool_call> blocks back out; pi-rs runs the tools.
// Model files come from Hugging Face / WebLLM on first use (cached by the browser afterwards).
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

// Keep the model files in the browser (Cache Storage) so a reload reads them from there.
env.useBrowserCache = true;
const TF_CACHE = 'transformers-cache';
const TF_MODEL = 'onnx-community/Qwen3-0.6B-ONNX';
/** Whether the model's weights are already stored in this browser. */
async function isCached(size) {
  try {
    if (MLC[size]) {
      const { hasModelInCache } = await import('https://esm.run/@mlc-ai/web-llm@0.2.88');
      return await hasModelInCache(MLC[size]);
    }
    const keys = await (await caches.open(TF_CACHE)).keys();
    return keys.some((k) => k.url.includes(TF_MODEL) && /\.onnx(_data)?$/.test(k.url));
  } catch { return false; }
}

let generator, engine, engineId;
// WebLLM prebuilt models by size key (q4f16). 0.6b uses Transformers.js below.
const MLC = { '1.7b': 'Qwen3-1.7B-q4f16_1-MLC', '4b': 'Qwen3-4B-q4f16_1-MLC', '8b': 'Qwen3-8B-q4f16_1-MLC' };

function toolInstruction(tools) {
  const list = tools.map((t) => ({ type: 'function', function: t }));
  return `Tools: ${JSON.stringify(list)}\nTo call a tool, output exactly <tool_call>{"name":"tool_name","arguments":{...}}</tool_call> and nothing else. After you receive <tool_response>, answer the user briefly in their language, copying numbers only from the tool response. /no_think`;
}

function chatMessages(data, inlineTools) {
  const out = [];
  const system = data.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  out.push({ role: 'system', content: inlineTools ? `${system}\n\n${toolInstruction(data.tools)}` : system });
  for (const m of data.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      // A small model needs the ask restated next to the result, or it answers with one number.
      const question = [...data.messages].reverse().find((x) => x.role === 'user')?.content ?? '';
      const ask = m === data.messages[data.messages.length - 1]
        ? `\n\n上のツールの結果だけを使って、質問「${question}」に日本語で2〜3文で答えてください。最初に判定（帰れる／帰れない など）、次に結果に書かれた主な数字をそのまま書く。`
        : '';
      out.push(inlineTools ? { role: 'user', content: `<tool_response>${m.content}</tool_response>${ask}` } : { role: 'tool', content: m.content + ask });
    }
    else if (m.role === 'assistant' && m.calls?.length) out.push({ role: 'assistant', content: m.calls.map((c) => `<tool_call>${JSON.stringify({ name: c.name, arguments: JSON.parse(c.arguments || '{}') })}</tool_call>`).join('') });
    else out.push({ role: m.role, content: m.content ?? '' });
  }
  return out;
}

let reported = false;
self.onmessage = async ({ data }) => {
  try {
    if (!navigator.gpu) throw new Error('このブラウザではアプリ内AIを動かせません。Chrome の新しい版で試してください。');
    if (!reported && !generator && !engine) { reported = true; self.postMessage({ type: 'cache', cached: await isCached(data.model) }); }
    if (MLC[data.model]) {
      if (!engine || engineId !== MLC[data.model]) {
        const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm@0.2.88');
        engineId = MLC[data.model];
        engine = await CreateMLCEngine(engineId, { initProgressCallback: (p) => self.postMessage({ type: 'progress', progress: p.progress * 100 }) });
      }
      const response = await engine.chat.completions.create({ messages: chatMessages(data, true), temperature: 0, max_tokens: 768, extra_body: { enable_thinking: false } });
      return output(response.choices[0].message.content || '');
    }
    if (!generator) {
      generator = await pipeline('text-generation', TF_MODEL, {
        device: 'webgpu', dtype: 'q4f16', progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'progress', progress: p.progress }); },
      });
    }
    const tools = data.tools.map((t) => ({ type: 'function', function: t }));
    const prompt = generator.tokenizer.apply_chat_template(chatMessages(data, false), { tokenize: false, add_generation_prompt: true, tools, enable_thinking: false });
    const result = await generator(prompt, { max_new_tokens: 768, do_sample: false, return_full_text: false });
    output(result[0].generated_text);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error?.message || error) });
  }
};

/** The first balanced {...} at or after `from`, or null. Small models sometimes drop </tool_call>. */
function objectAt(s, from) {
  const start = s.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { json: s.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

function output(answer) {
  const calls = [];
  let rest = answer.replace(/<think>[\s\S]*?<\/think>/g, '');
  let text = '';
  for (;;) {
    const at = rest.indexOf('<tool_call>');
    if (at < 0) { text += rest; break; }
    text += rest.slice(0, at);
    const obj = objectAt(rest, at);
    if (!obj) break;
    try {
      const call = JSON.parse(obj.json);
      if (call.name) calls.push({ id: crypto.randomUUID(), name: call.name, arguments: JSON.stringify(call.arguments ?? {}) });
    } catch { /* malformed call: leave it out */ }
    rest = rest.slice(obj.end).replace(/^\s*"?\s*(<\/tool_call>)?/, '');
  }
  self.postMessage({ type: 'result', text: text.trim(), calls, raw: answer });
}
