// Shapes shared by the agent tools, the agents (rules, pi-rs) and the question panel.
// Agreed with #10 (explore_hokkaido). Numbers only ever come from a tool's run(): agents and the
// rules version pass tool text through and never compute numbers of their own.

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
  /** 'compute' returns numbers from the Rust engine / NASA data; 'view' only changes what is shown. */
  kind: 'compute' | 'view';
  run(args: any): Promise<ToolResult>;
}

export interface ToolResult {
  text: string;
  data?: unknown;
  sources?: { label: string; url?: string }[];
  sql?: string;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; result: ToolResult; ok: boolean }
  | { type: 'error'; message: string }
  /** Progress the panel shows while waiting (e.g. an in-browser model loading); '' clears it. */
  | { type: 'status'; text: string }
  | { type: 'done' };

export interface AgentPort {
  id: string;
  label: string;
  available(): boolean | Promise<boolean>;
  ask(prompt: string, tools: ToolDef[], onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void>;
}

/** What a model sees of a tool. */
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
