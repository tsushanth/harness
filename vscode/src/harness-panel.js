"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarnessPanel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const openai_1 = __importDefault(require("openai"));
const context_1 = require("./context");
const diff_applier_1 = require("./diff-applier");
// Dynamic import for the ESM harness package
async function loadHarness() {
    const { Harness, CodebaseIndex, codebaseSearchProvider, formatCost } = await import("@tsushanth/harness");
    return { Harness, CodebaseIndex, codebaseSearchProvider, formatCost };
}
// ── Provider helpers ──────────────────────────────────────────────────────────
function getProviderConfig(context, secrets) {
    const config = vscode.workspace.getConfiguration("harness");
    const provider = config.get("provider", "groq");
    const modelOverride = config.get("model", "").trim();
    const DEFAULTS = {
        openrouter: {
            baseURL: "https://openrouter.ai/api/v1",
            model: "meta-llama/llama-3.3-70b-instruct",
        },
        groq: {
            baseURL: "https://api.groq.com/openai/v1",
            model: "llama-3.3-70b-versatile",
        },
        ollama: {
            baseURL: config.get("ollamaBaseUrl", "http://localhost:11434") + "/v1",
            model: "llama3.3",
        },
    };
    const def = DEFAULTS[provider];
    if (!def)
        return null;
    const apiKey = provider === "ollama" ? "ollama" : (secrets.apiKey ?? "");
    if (!apiKey && provider !== "ollama")
        return null;
    const client = new openai_1.default({ apiKey, baseURL: def.baseURL });
    const model = modelOverride || def.model;
    return { client, model };
}
// ── Tool definitions ──────────────────────────────────────────────────────────
function buildTools(secrets, send) {
    const { execSync } = require("child_process");
    const { readFileSync, writeFileSync, existsSync } = require("fs");
    return [
        {
            name: "read_file",
            description: "Read the contents of a file.",
            parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
            },
            fn: (args) => {
                const p = args["path"];
                if (!existsSync(p))
                    return { error: `File not found: ${p}` };
                return { content: readFileSync(p, "utf8") };
            },
        },
        {
            name: "write_file",
            description: "Write content to a file (overwrites).",
            parameters: {
                type: "object",
                properties: { path: { type: "string" }, content: { type: "string" } },
                required: ["path", "content"],
            },
            fn: (args) => {
                writeFileSync(args["path"], args["content"], "utf8");
                return { success: true };
            },
        },
        {
            name: "apply_diff",
            description: "Apply a unified diff to edit a file. Prefer this over write_file for code edits. " +
                "Output a diff block in --- / +++ / @@ format.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    diff: { type: "string" },
                },
                required: ["path", "diff"],
            },
            fn: async (args) => {
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const result = await (0, diff_applier_1.applyDiffsFromResponse)("```diff\n" + args["diff"] + "\n```", workspaceRoot);
                return result;
            },
        },
        {
            name: "shell",
            description: "Run a shell command. Returns stdout. Timeout 10s.",
            parameters: {
                type: "object",
                properties: { command: { type: "string" } },
                required: ["command"],
            },
            fn: (args) => {
                try {
                    const output = execSync(args["command"], {
                        timeout: 10_000,
                        encoding: "utf8",
                        stdio: ["pipe", "pipe", "pipe"],
                    });
                    return { output };
                }
                catch (err) {
                    const e = err;
                    return { error: e.stderr ?? e.message ?? String(err), output: e.stdout ?? "" };
                }
            },
        },
        {
            name: "web_search",
            description: "Search the web. Use for current events or factual lookups.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" },
                    count: { type: "number" },
                },
                required: ["query"],
            },
            fn: async (args) => {
                const key = secrets.braveKey;
                if (!key)
                    return { error: "No BRAVE_SEARCH_API_KEY configured" };
                const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args["query"])}&count=${Math.min(args["count"] ?? 5, 10)}`;
                const res = await fetch(url, {
                    headers: { Accept: "application/json", "X-Subscription-Token": key },
                });
                const data = await res.json();
                return (data.web?.results ?? []).map((r) => ({
                    title: r.title,
                    url: r.url,
                    snippet: r.description,
                }));
            },
        },
        {
            name: "calculate",
            description: "Evaluate a math expression.",
            parameters: {
                type: "object",
                properties: { expression: { type: "string" } },
                required: ["expression"],
            },
            fn: (args) => {
                try {
                    return { result: Function(`"use strict"; return (${args["expression"]})`)() };
                }
                catch (e) {
                    return { error: String(e) };
                }
            },
        },
    ];
}
// ── Panel ─────────────────────────────────────────────────────────────────────
class HarnessPanel {
    static current;
    _panel;
    _extensionUri;
    _disposables = [];
    _context;
    _abortController = null;
    static createOrShow(extensionContext) {
        const column = vscode.ViewColumn.Beside;
        if (HarnessPanel.current) {
            HarnessPanel.current._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel("harnessChat", "Harness", column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionContext.extensionUri, "webview")],
        });
        HarnessPanel.current = new HarnessPanel(panel, extensionContext);
    }
    static sendPrompt(prompt) {
        HarnessPanel.current?._panel.webview.postMessage({ type: "inject_prompt", prompt });
    }
    constructor(panel, context) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;
        this._context = context;
        this._panel.webview.html = this._getHtmlForWebview();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case "chat":
                    await this._handleChat(message.data);
                    break;
                case "abort":
                    this._abortController?.abort();
                    break;
                case "build_index":
                    await this._handleBuildIndex();
                    break;
                case "search_code":
                    await this._handleSearchCode(message.data);
                    break;
                case "apply_diffs":
                    await this._handleApplyDiffs(message.data);
                    break;
                case "get_context":
                    this._sendEditorContext();
                    break;
                case "open_settings":
                    vscode.commands.executeCommand("workbench.action.openSettings", "harness");
                    break;
                case "set_api_key":
                    vscode.commands.executeCommand("harness.setApiKey");
                    break;
            }
        }, null, this._disposables);
    }
    _send(type, data) {
        this._panel.webview.postMessage({ type, data });
    }
    _sendEditorContext() {
        const ctx = (0, context_1.collectEditorContext)();
        this._send("editor_context", ctx);
    }
    async _handleChat(req) {
        this._abortController = new AbortController();
        const send = (type, data) => this._send(type, data);
        try {
            const apiKey = await this._context.secrets.get("harness.apiKey") ?? undefined;
            const braveKey = await this._context.secrets.get("harness.braveApiKey") ?? undefined;
            const providerCfg = getProviderConfig(this._context, { apiKey, braveKey });
            if (!providerCfg) {
                send("error", { message: "API key not set. Run 'Harness: Set API Key' from the command palette." });
                return;
            }
            const { Harness, CodebaseIndex, codebaseSearchProvider, formatCost } = await loadHarness();
            // Build context block from editor state
            const editorCtx = (0, context_1.collectEditorContext)();
            let contextBlock = req.includeEditorContext ? (0, context_1.buildContextBlock)(editorCtx) : "";
            // Codebase index context
            const config = vscode.workspace.getConfiguration("harness");
            const enableCodebase = config.get("enableCodebaseContext", true);
            const workspaceRoot = editorCtx.workspaceRoot;
            const indexPath = workspaceRoot
                ? path.join(workspaceRoot, config.get("indexPath", ".harness-index.json"))
                : config.get("indexPath", ".harness-index.json");
            const index = new CodebaseIndex(providerCfg.client, indexPath);
            const contextProviders = enableCodebase && index.isBuilt()
                ? [codebaseSearchProvider(index, req.messages[req.messages.length - 1]?.content ?? "")]
                : [];
            // Instrument tools to relay call/result to webview
            const rawTools = buildTools({ braveKey }, send);
            const tools = rawTools.map((t) => ({
                ...t,
                fn: async (args) => {
                    send("tool_call", { name: t.name, args });
                    const result = await t.fn(args);
                    send("tool_result", { name: t.name, result });
                    return result;
                },
            }));
            // Prepend editor context as a system addendum if present
            const systemPrompt = [req.systemPrompt, contextBlock].filter(Boolean).join("\n\n") || undefined;
            send("start", { model: providerCfg.model });
            const harness = new Harness({ client: providerCfg.client, model: providerCfg.model });
            const result = await harness.run({
                messages: req.messages,
                tools,
                systemPrompt,
                contextProviders,
                signal: this._abortController.signal,
            });
            const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
            const text = lastAssistant && "content" in lastAssistant && typeof lastAssistant.content === "string"
                ? lastAssistant.content
                : "";
            send("answer", {
                text,
                usage: result.usage,
                cost: result.cost,
                turns: result.turns,
                toolCallsMade: result.toolCallsMade,
                model: providerCfg.model,
                hasDiffs: /```diff/.test(text),
            });
        }
        catch (err) {
            if (err?.name !== "AbortError") {
                send("error", { message: String(err) });
            }
            else {
                send("aborted", {});
            }
        }
        finally {
            this._abortController = null;
        }
    }
    async _handleBuildIndex() {
        const send = (type, data) => this._send(type, data);
        const apiKey = await this._context.secrets.get("harness.apiKey") ?? undefined;
        const providerCfg = getProviderConfig(this._context, { apiKey });
        if (!providerCfg) {
            send("index_error", { message: "API key not set. Set it first via 'Harness: Set API Key'." });
            return;
        }
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            send("index_error", { message: "No workspace open." });
            return;
        }
        const config = vscode.workspace.getConfiguration("harness");
        const provider = config.get("provider", "groq");
        if (provider === "ollama") {
            process.env["HARNESS_EMBEDDING_MODEL"] = "nomic-embed-text";
        }
        else if (provider === "openrouter") {
            process.env["HARNESS_EMBEDDING_MODEL"] = "openai/text-embedding-3-small";
        }
        const indexPath = path.join(workspaceRoot, config.get("indexPath", ".harness-index.json"));
        send("index_progress", { phase: "chunking", message: "Scanning files…" });
        try {
            const { CodebaseIndex } = await loadHarness();
            const index = new CodebaseIndex(providerCfg.client, indexPath);
            const { chunks, files } = await index.build(workspaceRoot, (phase, done, total) => {
                send("index_progress", { phase, done, total });
            });
            send("index_done", { chunks, files });
        }
        catch (err) {
            send("index_error", { message: String(err) });
        }
    }
    async _handleSearchCode(query) {
        const send = (type, data) => this._send(type, data);
        const apiKey = await this._context.secrets.get("harness.apiKey") ?? undefined;
        const providerCfg = getProviderConfig(this._context, { apiKey });
        if (!providerCfg) {
            send("search_result", { error: "API key not set." });
            return;
        }
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ".";
        const config = vscode.workspace.getConfiguration("harness");
        const indexPath = path.join(workspaceRoot, config.get("indexPath", ".harness-index.json"));
        const { CodebaseIndex } = await loadHarness();
        const index = new CodebaseIndex(providerCfg.client, indexPath);
        if (!index.isBuilt()) {
            send("search_result", { error: "Index not built." });
            return;
        }
        const results = await index.search(query, 5);
        send("search_result", { results });
    }
    async _handleApplyDiffs(responseText) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const result = await (0, diff_applier_1.applyDiffsFromResponse)(responseText, workspaceRoot);
        this._send("diffs_applied", result);
        if (result.errors.length > 0) {
            vscode.window.showWarningMessage(`Harness: ${result.errors.join("; ")}`);
        }
        else {
            vscode.window.showInformationMessage(`Harness: Applied ${result.applied} file change(s).`);
        }
    }
    _getHtmlForWebview() {
        const webviewPath = path.join(this._extensionUri.fsPath, "webview", "chat.html");
        if (fs.existsSync(webviewPath)) {
            return fs.readFileSync(webviewPath, "utf8");
        }
        // Fallback if webview file not found
        return `<html><body style="color:white;padding:20px">
      <p>Webview file not found at ${webviewPath}</p>
    </body></html>`;
    }
    dispose() {
        HarnessPanel.current = undefined;
        this._abortController?.abort();
        this._panel.dispose();
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
    }
}
exports.HarnessPanel = HarnessPanel;
//# sourceMappingURL=harness-panel.js.map