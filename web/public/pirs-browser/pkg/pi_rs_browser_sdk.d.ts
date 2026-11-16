/* tslint:disable */
/* eslint-disable */

/**
 * One POST with bounded streaming. The host owns endpoint and headers.
 */
export class BrowserFetch {
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    constructor(endpoint: string, body: string, headers: object);
    /**
     * Resolves after response headers; errors never include response bodies or credentials.
     */
    open(): Promise<number>;
    /**
     * Returns one byte chunk, or undefined at EOF. Only one read may be pending.
     */
    read(): Promise<any>;
}

export class BrowserSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    /**
     * Close an idle session and wait for its cross-tab lock to be released.
     */
    close(): Promise<any>;
    messages(): string;
    /**
     * Opens a persisted session. `key` identifies it within this origin.
     */
    static open(key: string, endpoint: string, model: string, bearer: string, timeout_ms: number): Promise<BrowserSession>;
    /**
     * Opens a demonstration session with a built-in, side-effect-free addition tool.
     */
    static open_demo(key: string, endpoint: string, model: string, bearer: string, timeout_ms: number): Promise<BrowserSession>;
    /**
     * Opens a session whose tools are implemented by the page. `tools_json` is an array of
     * `{ name, description, parameters }`; `call(name, argumentsJson)` resolves to `{ ok, text }`.
     */
    static open_with_tools(key: string, endpoint: string, model: string, bearer: string, timeout_ms: number, system_prompt: string, tools_json: string, call: Function): Promise<BrowserSession>;
    prompt(input: string): Promise<any>;
    /**
     * Resume a previously interrupted or settled session without adding input.
     */
    resume(): Promise<any>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_browserfetch_free: (a: number, b: number) => void;
    readonly __wbg_browsersession_free: (a: number, b: number) => void;
    readonly browserfetch_cancel: (a: number) => void;
    readonly browserfetch_new: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly browserfetch_open: (a: number) => any;
    readonly browserfetch_read: (a: number) => any;
    readonly browsersession_cancel: (a: number) => void;
    readonly browsersession_close: (a: number) => any;
    readonly browsersession_messages: (a: number) => [number, number, number, number];
    readonly browsersession_open: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly browsersession_open_demo: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly browsersession_open_with_tools: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: any) => any;
    readonly browsersession_prompt: (a: number, b: number, c: number) => any;
    readonly browsersession_resume: (a: number) => any;
    readonly wasm_bindgen__convert__closures_____invoke__h4caf5ba5eac5164c: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__he283a419838be31f: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h1c22612b316178b8: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
