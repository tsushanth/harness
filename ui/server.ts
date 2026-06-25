#!/usr/bin/env npx tsx
/**
 * Harness UI server — chat interface for open LLMs via the harness.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx ui/server.ts
 *   GROQ_API_KEY=gsk_...         npx tsx ui/server.ts --port 4000
 */
import express from "express";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import OpenAI from "openai";
import {
  Harness,
  formatCost,
  applyDiff,
  codebaseSearchProvider,
} from "../src/index.js";
import { CodebaseIndex } from "../src/index/codebase.js";
import type { ToolDefinition, RunResult } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "3737");
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const INDEX_PATH = process.env.HARNESS_INDEX_PATH ?? ".harness-index.json";

if (!OPENROUTER_KEY && !GROQ_KEY) {
  console.error("Error: set OPENROUTER_API_KEY or GROQ_API_KEY");
  process.exit(1);
}

// ── Providers ─────────────────────────────────────────────────────────────────
const PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_KEY ?? "",
    models: [
      "meta-llama/llama-3.3-70b-instruct",
      "meta-llama/llama-3.1-8b-instruct",
      "qwen/qwen-2.5-72b-instruct",
      "mistralai/mistral-7b-instruct",
      "google/gemma-3-27b-it",
    ],
    available: !!OPENROUTER_KEY,
  },
  {
    id: "groq",
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: GROQ_KEY ?? "",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
    ],
    available: !!GROQ_KEY,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
    models: ["llama3.3", "qwen2.5", "mistral"],
    available: true,
  },
];

function makeClient(providerId: string): { client: OpenAI; defaultModel: string } {
  const p = PROVIDERS.find((x) => x.id === providerId) ?? PROVIDERS.find((x) => x.available)!;
  const client = new OpenAI({ apiKey: p.apiKey, baseURL: p.baseURL });
  return { client, defaultModel: p.models[0]! };
}

// ── Tools ─────────────────────────────────────────────────────────────────────
function buildTools(client: OpenAI, indexPath: string): ToolDefinition[] {
  return [
    {
      name: "web_search",
      description: "Search the web. Use for current events, facts, or anything requiring live data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          count: { type: "number", description: "Results to return (default 5, max 10)" },
        },
        required: ["query"],
      },
      fn: async ({ query, count }) => {
        if (!BRAVE_KEY) return { error: "No BRAVE_SEARCH_API_KEY set" };
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query as string)}&count=${Math.min((count as number) ?? 5, 10)}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY },
        });
        const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
        return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
      },
    },
    {
      name: "read_file",
      description: "Read the contents of a file at the given path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      fn: ({ path }) => {
        const p = path as string;
        if (!existsSync(p)) return { error: `File not found: ${p}` };
        return { content: readFileSync(p, "utf8") };
      },
    },
    {
      name: "write_file",
      description: "Write text content to a file (overwrites if exists).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      fn: ({ path, content }) => {
        writeFileSync(path as string, content as string, "utf8");
        return { success: true };
      },
    },
    {
      name: "shell",
      description: "Run a shell command. Returns stdout. Timeout: 10s.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
      fn: ({ command }) => {
        try {
          const output = execSync(command as string, { timeout: 10_000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
          return { output };
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return { error: e.stderr ?? e.message ?? String(err), output: e.stdout ?? "" };
        }
      },
    },
    {
      name: "apply_diff",
      description: "Apply a unified diff to a file. Prefer this over write_file for code edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          diff: { type: "string", description: "Unified diff (--- / +++ / @@ format)" },
        },
        required: ["path", "diff"],
      },
      fn: ({ path, diff }) => applyDiff(path as string, diff as string),
    },
    {
      name: "calculate",
      description: "Evaluate a math expression.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
      fn: ({ expression }) => {
        try {
          return { result: Function(`"use strict"; return (${expression as string})`)() };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  ];
}

// ── SSE helpers ───────────────────────────────────────────────────────────────
type SSEWriter = (event: string, data: unknown) => void;

function makeSSE(res: express.Response): SSEWriter {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Config endpoint
app.get("/api/config", (_req, res) => {
  res.json({
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      models: p.models,
      available: p.available,
    })),
    hasBraveSearch: !!BRAVE_KEY,
    indexPath: INDEX_PATH,
  });
});

// Index status
app.get("/api/index/status", (req, res) => {
  const { provider = "openrouter" } = req.query as { provider?: string };
  const { client } = makeClient(provider);
  const index = new CodebaseIndex(client, INDEX_PATH);
  res.json(index.isBuilt() ? { built: true, stats: index.stats() } : { built: false });
});

// Build index
app.post("/api/index/build", async (req, res) => {
  const { directory = ".", provider = "openrouter" } = req.body as { directory?: string; provider?: string };
  const send = makeSSE(res);
  try {
    const { client } = makeClient(provider);
    if (!OPENROUTER_KEY && provider === "openrouter") {
      send("error", { message: "OpenRouter key required for embeddings" });
      return res.end();
    }
    process.env.HARNESS_EMBEDDING_MODEL = provider === "openrouter"
      ? "openai/text-embedding-3-small"
      : "text-embedding-3-small";
    const index = new CodebaseIndex(client, INDEX_PATH);
    send("progress", { phase: "chunking", message: "Scanning files..." });
    const { chunks, files } = await index.build(directory, (phase, done, total) => {
      send("progress", { phase, done, total });
    });
    send("done", { chunks, files });
  } catch (err) {
    send("error", { message: String(err) });
  }
  res.end();
});

// Search code
app.post("/api/index/search", async (req, res) => {
  const { query, topK = 5, provider = "openrouter" } = req.body as { query: string; topK?: number; provider?: string };
  const { client } = makeClient(provider);
  const index = new CodebaseIndex(client, INDEX_PATH);
  if (!index.isBuilt()) {
    res.status(400).json({ error: "Index not built. Run build_index first." });
    return;
  }
  const results = await index.search(query, topK);
  res.json({ results });
});

// Chat — main SSE endpoint
app.post("/api/chat", async (req, res) => {
  const {
    messages,
    provider = "openrouter",
    model,
    systemPrompt,
    useCodebaseContext = true,
  } = req.body as {
    messages: Array<{ role: string; content: string }>;
    provider?: string;
    model?: string;
    systemPrompt?: string;
    useCodebaseContext?: boolean;
  };

  const send = makeSSE(res);
  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  try {
    const { client, defaultModel } = makeClient(provider);
    const resolvedModel = model ?? defaultModel;

    // Patch-in tool call visibility via a wrapper
    const tools = buildTools(client, INDEX_PATH);
    const instrumentedTools: ToolDefinition[] = tools.map((t) => ({
      ...t,
      fn: async (args: Record<string, unknown>) => {
        send("tool_call", { name: t.name, args });
        const result = await (t.fn as (args: Record<string, unknown>) => unknown)(args);
        send("tool_result", { name: t.name, result });
        return result;
      },
    }));

    const index = new CodebaseIndex(client, INDEX_PATH);
    const contextProviders =
      useCodebaseContext && index.isBuilt()
        ? [codebaseSearchProvider(index, messages[messages.length - 1]?.content ?? "")]
        : [];

    send("start", { model: resolvedModel });

    const harness = new Harness({ client, model: resolvedModel });
    const result: RunResult = await harness.run({
      messages: messages as Array<{ role: "user" | "assistant" | "system"; content: string }>,
      tools: instrumentedTools,
      systemPrompt,
      contextProviders,
      signal: abortController.signal,
    });

    const lastAssistant = [...result.messages]
      .reverse()
      .find((m) => m.role === "assistant");

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
    });
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") {
      send("error", { message: String(err) });
    }
  }
  res.end();
});

createServer(app).listen(PORT, () => {
  console.log(`\nHarness UI  →  http://localhost:${PORT}\n`);
  console.log(`  Provider  : ${OPENROUTER_KEY ? "OpenRouter" : GROQ_KEY ? "Groq" : "Ollama"}`);
  console.log(`  Web search: ${BRAVE_KEY ? "Brave ✓" : "not configured (set BRAVE_SEARCH_API_KEY)"}`);
  console.log(`  Index     : ${existsSync(INDEX_PATH) ? INDEX_PATH + " ✓" : "not built (use the UI)"}\n`);
});
