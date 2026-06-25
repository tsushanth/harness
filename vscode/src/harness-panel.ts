import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { collectEditorContext, buildContextBlock } from "./context";
import { applyDiffsFromResponse } from "./diff-applier";

// Dynamic import for the ESM harness package (brings its own OpenAI dep)
async function loadHarness() {
  const mod = await import("@tsushanth/harness");
  const { Harness, CodebaseIndex, codebaseSearchProvider, formatCost } = mod;
  // Also grab OpenAI from the harness package's own node_modules
  const { default: OpenAI } = await import("openai");
  return { Harness, CodebaseIndex, codebaseSearchProvider, formatCost, OpenAI };
}

// ── Provider helpers ──────────────────────────────────────────────────────────

async function getProviderConfig(
  context: vscode.ExtensionContext,
  secrets: { apiKey?: string; braveKey?: string }
): Promise<{ client: unknown; model: string } | null> {
  const { OpenAI } = await loadHarness();
  const config = vscode.workspace.getConfiguration("harness");
  const provider = config.get<string>("provider", "groq");
  const modelOverride = config.get<string>("model", "").trim();

  const DEFAULTS: Record<string, { baseURL: string; model: string }> = {
    openrouter: {
      baseURL: "https://openrouter.ai/api/v1",
      model: "meta-llama/llama-3.3-70b-instruct",
    },
    groq: {
      baseURL: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
    },
    ollama: {
      baseURL: config.get<string>("ollamaBaseUrl", "http://localhost:11434") + "/v1",
      model: "llama3.3",
    },
  };

  const def = DEFAULTS[provider];
  if (!def) return null;

  const apiKey = provider === "ollama" ? "ollama" : (secrets.apiKey ?? "");
  if (!apiKey && provider !== "ollama") return null;

  const client = new OpenAI({ apiKey, baseURL: def.baseURL });
  const model = modelOverride || def.model;
  return { client, model };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

function buildTools(secrets: { braveKey?: string }, send: (type: string, data: unknown) => void) {
  const { execSync } = require("child_process") as typeof import("child_process");
  const { readFileSync, writeFileSync, existsSync } = require("fs") as typeof import("fs");

  return [
    {
      name: "read_file",
      description: "Read the contents of a file.",
      parameters: {
        type: "object" as const,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      fn: (args: Record<string, unknown>) => {
        const p = args["path"] as string;
        if (!existsSync(p)) return { error: `File not found: ${p}` };
        return { content: readFileSync(p, "utf8") };
      },
    },
    {
      name: "write_file",
      description: "Write content to a file (overwrites).",
      parameters: {
        type: "object" as const,
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      fn: (args: Record<string, unknown>) => {
        writeFileSync(args["path"] as string, args["content"] as string, "utf8");
        return { success: true };
      },
    },
    {
      name: "apply_diff",
      description:
        "Apply a unified diff to edit a file. Prefer this over write_file for code edits. " +
        "Output a diff block in --- / +++ / @@ format.",
      parameters: {
        type: "object" as const,
        properties: {
          path: { type: "string" },
          diff: { type: "string" },
        },
        required: ["path", "diff"],
      },
      fn: async (args: Record<string, unknown>) => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const result = await applyDiffsFromResponse(
          "```diff\n" + (args["diff"] as string) + "\n```",
          workspaceRoot
        );
        return result;
      },
    },
    {
      name: "shell",
      description: "Run a shell command. Returns stdout. Timeout 10s.",
      parameters: {
        type: "object" as const,
        properties: { command: { type: "string" } },
        required: ["command"],
      },
      fn: (args: Record<string, unknown>) => {
        try {
          const output = execSync(args["command"] as string, {
            timeout: 10_000,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { output };
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return { error: e.stderr ?? e.message ?? String(err), output: e.stdout ?? "" };
        }
      },
    },
    {
      name: "web_search",
      description: "Search the web. Use for current events or factual lookups.",
      parameters: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          count: { type: "number" },
        },
        required: ["query"],
      },
      fn: async (args: Record<string, unknown>) => {
        const key = secrets.braveKey;
        if (!key) return { error: "No BRAVE_SEARCH_API_KEY configured" };
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args["query"] as string)}&count=${Math.min((args["count"] as number) ?? 5, 10)}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
        });
        const data = await res.json() as {
          web?: { results?: Array<{ title: string; url: string; description: string }> };
        };
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
        type: "object" as const,
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
      fn: (args: Record<string, unknown>) => {
        try {
          return { result: Function(`"use strict"; return (${args["expression"] as string})`)() };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  ];
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export class HarnessPanel {
  public static current: HarnessPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _context: vscode.ExtensionContext;
  private _abortController: AbortController | null = null;

  public static createOrShow(extensionContext: vscode.ExtensionContext) {
    const column = vscode.ViewColumn.Beside;
    if (HarnessPanel.current) {
      HarnessPanel.current._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "harnessChat",
      "Harness",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionContext.extensionUri, "webview")],
      }
    );

    HarnessPanel.current = new HarnessPanel(panel, extensionContext);
  }

  public static sendPrompt(prompt: string) {
    HarnessPanel.current?._panel.webview.postMessage({ type: "inject_prompt", prompt });
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._extensionUri = context.extensionUri;
    this._context = context;

    this._panel.webview.html = this._getHtmlForWebview();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: { type: string; data?: unknown }) => {
        switch (message.type) {
          case "chat":
            await this._handleChat(message.data as ChatRequest);
            break;
          case "abort":
            this._abortController?.abort();
            break;
          case "build_index":
            await this._handleBuildIndex();
            break;
          case "search_code":
            await this._handleSearchCode(message.data as string);
            break;
          case "apply_diffs":
            await this._handleApplyDiffs(message.data as string);
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
      },
      null,
      this._disposables
    );
  }

  private _send(type: string, data: unknown) {
    this._panel.webview.postMessage({ type, data });
  }

  private _sendEditorContext() {
    const ctx = collectEditorContext();
    this._send("editor_context", ctx);
  }

  private async _handleChat(req: ChatRequest) {
    this._abortController = new AbortController();
    const send = (type: string, data: unknown) => this._send(type, data);

    try {
      const apiKey = await this._context.secrets.get("harness.apiKey") ?? undefined;
      const braveKey = await this._context.secrets.get("harness.braveApiKey") ?? undefined;

      const providerCfg = await getProviderConfig(this._context, { apiKey, braveKey });
      if (!providerCfg) {
        send("error", { message: "API key not set. Run 'Harness: Set API Key' from the command palette." });
        return;
      }

      const { Harness, CodebaseIndex, codebaseSearchProvider, formatCost } = await loadHarness();

      // Build context block from editor state
      const editorCtx = collectEditorContext();
      let contextBlock = req.includeEditorContext ? buildContextBlock(editorCtx) : "";

      // Codebase index context
      const config = vscode.workspace.getConfiguration("harness");
      const enableCodebase = config.get<boolean>("enableCodebaseContext", true);
      const workspaceRoot = editorCtx.workspaceRoot;
      const indexPath = workspaceRoot
        ? path.join(workspaceRoot, config.get<string>("indexPath", ".harness-index.json"))
        : config.get<string>("indexPath", ".harness-index.json");

      const index = new CodebaseIndex(providerCfg.client as never, indexPath);
      const contextProviders = enableCodebase && index.isBuilt()
        ? [codebaseSearchProvider(index, req.messages[req.messages.length - 1]?.content ?? "")]
        : [];

      // Instrument tools to relay call/result to webview
      const rawTools = buildTools({ braveKey }, send);
      const tools = rawTools.map((t) => ({
        ...t,
        fn: async (args: Record<string, unknown>) => {
          send("tool_call", { name: t.name, args });
          const result = await (t.fn as (a: Record<string, unknown>) => unknown)(args);
          send("tool_result", { name: t.name, result });
          return result;
        },
      }));

      // Prepend editor context as a system addendum if present
      const systemPrompt = [req.systemPrompt, contextBlock].filter(Boolean).join("\n\n") || undefined;

      send("start", { model: providerCfg.model });

      const harness = new Harness({ client: providerCfg.client as never, model: providerCfg.model });
      const result = await harness.run({
        messages: req.messages as Array<{ role: "user" | "assistant" | "system"; content: string }>,
        tools,
        systemPrompt,
        contextProviders,
        signal: this._abortController.signal,
      });

      const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
      const text =
        lastAssistant && "content" in lastAssistant && typeof lastAssistant.content === "string"
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
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        send("error", { message: String(err) });
      } else {
        send("aborted", {});
      }
    } finally {
      this._abortController = null;
    }
  }

  private async _handleBuildIndex() {
    const send = (type: string, data: unknown) => this._send(type, data);

    const apiKey = await this._context.secrets.get("harness.apiKey") ?? undefined;
    const providerCfg = await getProviderConfig(this._context, { apiKey });
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
    const provider = config.get<string>("provider", "groq");
    if (provider === "ollama") {
      process.env["HARNESS_EMBEDDING_MODEL"] = "nomic-embed-text";
    } else if (provider === "openrouter") {
      process.env["HARNESS_EMBEDDING_MODEL"] = "openai/text-embedding-3-small";
    }

    const indexPath = path.join(workspaceRoot, config.get<string>("indexPath", ".harness-index.json"));

    send("index_progress", { phase: "chunking", message: "Scanning files…" });

    try {
      const { CodebaseIndex } = await loadHarness();
      const index = new CodebaseIndex(providerCfg.client as never, indexPath);
      const { chunks, files } = await index.build(workspaceRoot, (phase, done, total) => {
        send("index_progress", { phase, done, total });
      });
      send("index_done", { chunks, files });
    } catch (err) {
      send("index_error", { message: String(err) });
    }
  }

  private async _handleSearchCode(query: string) {
    const send = (type: string, data: unknown) => this._send(type, data);
    const apiKey = await this._context.secrets.get("harness.apiKey") ?? undefined;
    const providerCfg = await getProviderConfig(this._context, { apiKey });
    if (!providerCfg) {
      send("search_result", { error: "API key not set." });
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ".";
    const config = vscode.workspace.getConfiguration("harness");
    const indexPath = path.join(workspaceRoot, config.get<string>("indexPath", ".harness-index.json"));

    const { CodebaseIndex } = await loadHarness();
    const index = new CodebaseIndex(providerCfg.client as never, indexPath);
    if (!index.isBuilt()) {
      send("search_result", { error: "Index not built." });
      return;
    }
    const results = await index.search(query, 5);
    send("search_result", { results });
  }

  private async _handleApplyDiffs(responseText: string) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const result = await applyDiffsFromResponse(responseText, workspaceRoot);
    this._send("diffs_applied", result);
    if (result.errors.length > 0) {
      vscode.window.showWarningMessage(`Harness: ${result.errors.join("; ")}`);
    } else {
      vscode.window.showInformationMessage(`Harness: Applied ${result.applied} file change(s).`);
    }
  }

  private _getHtmlForWebview() {
    const webviewPath = path.join(this._extensionUri.fsPath, "webview", "chat.html");
    if (fs.existsSync(webviewPath)) {
      return fs.readFileSync(webviewPath, "utf8");
    }
    // Fallback if webview file not found
    return `<html><body style="color:white;padding:20px">
      <p>Webview file not found at ${webviewPath}</p>
    </body></html>`;
  }

  public dispose() {
    HarnessPanel.current = undefined;
    this._abortController?.abort();
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}

interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  systemPrompt?: string;
  includeEditorContext: boolean;
}
