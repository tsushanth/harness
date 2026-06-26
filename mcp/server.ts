#!/usr/bin/env npx tsx
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Harness, formatCost, applyDiff, codebaseSearchProvider, SessionMemory, makeRememberTool } from "../src/index.js";
import { CodebaseIndex } from "../src/index/codebase.js";
import type { ToolDefinition } from "../src/index.js";

// ── Provider setup ────────────────────────────────────────────────────────────
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const TAVILY_KEY = process.env.TAVILY_API_KEY;

if (!OPENROUTER_KEY && !GROQ_KEY) {
  process.stderr.write(
    "Error: set OPENROUTER_API_KEY or GROQ_API_KEY in the MCP server env\n"
  );
  process.exit(1);
}

const client = OPENROUTER_KEY
  ? new OpenAI({ apiKey: OPENROUTER_KEY, baseURL: "https://openrouter.ai/api/v1" })
  : new OpenAI({ apiKey: GROQ_KEY, baseURL: "https://api.groq.com/openai/v1" });

const DEFAULT_MODEL = OPENROUTER_KEY
  ? "meta-llama/llama-3.3-70b-instruct"
  : "llama-3.3-70b-versatile";

const harness = new Harness({ client, model: DEFAULT_MODEL });

// ── Codebase index (optional, loaded lazily) ──────────────────────────────────
const INDEX_PATH = process.env.HARNESS_INDEX_PATH ?? ".harness-index.json";
const codebaseIndex = new CodebaseIndex(client, INDEX_PATH);

// ── Session memory (persists across MCP server restarts) ──────────────────────
const MEMORY_PATH = process.env.HARNESS_MEMORY_PATH ?? ".harness-memory.json";
const memory = new SessionMemory(MEMORY_PATH);

// ── Tool implementations ──────────────────────────────────────────────────────

async function webSearch(query: string, count = 5): Promise<unknown> {
  // Brave Search API
  if (BRAVE_KEY) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
    });
    if (!res.ok) throw new Error(`Brave Search ${res.status}: ${await res.text()}`);
    const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }

  // Tavily API
  if (TAVILY_KEY) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, max_results: count }),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
    const data = await res.json() as { results?: Array<{ title: string; url: string; content: string }> };
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }

  throw new Error(
    "No search API configured. Set BRAVE_SEARCH_API_KEY or TAVILY_API_KEY in the MCP server env."
  );
}

// ── Built-in tools the open model can use ────────────────────────────────────
const DEMO_TOOLS: ToolDefinition[] = [
  {
    name: "web_search",
    description:
      "Search the web and return the top results (title, URL, snippet). Use for current events, facts, or anything that needs live data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        count: { type: "number", description: "Number of results to return (default 5, max 10)." },
      },
      required: ["query"],
    },
    fn: async ({ query, count }) =>
      webSearch(query as string, Math.min((count as number | undefined) ?? 5, 10)),
  },
  {
    name: "read_file",
    description: "Read the contents of a file at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path." },
      },
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
    description: "Write text content to a file at the given path (overwrites if exists).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path." },
        content: { type: "string", description: "Text content to write." },
      },
      required: ["path", "content"],
    },
    fn: ({ path, content }) => {
      writeFileSync(path as string, content as string, "utf8");
      return { success: true, path };
    },
  },
  {
    name: "shell",
    description:
      "Run a shell command and return stdout. Avoid destructive commands. Timeout: 10s.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
      },
      required: ["command"],
    },
    fn: ({ command }) => {
      try {
        const output = execSync(command as string, {
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
    name: "apply_diff",
    description:
      "Apply a unified diff to a file. Use this instead of write_file when editing existing code — " +
      "produce a diff of only the changed lines, not the entire file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to patch." },
        diff: {
          type: "string",
          description:
            "Unified diff string (--- / +++ / @@ format). Only include changed lines and minimal context.",
        },
      },
      required: ["path", "diff"],
    },
    fn: ({ path, diff }) => {
      return applyDiff(path as string, diff as string);
    },
  },
  {
    name: "calculate",
    description: "Evaluate a mathematical expression and return the result.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "A JavaScript-safe math expression." },
      },
      required: ["expression"],
    },
    fn: ({ expression }) => {
      try {
        const result = Function(`"use strict"; return (${expression as string})`)();
        return { result };
      } catch (e) {
        return { error: String(e) };
      }
    },
  },
  {
    name: "get_current_time",
    description: "Return the current UTC date and time.",
    parameters: { type: "object", properties: {} },
    fn: () => ({ utc: new Date().toISOString() }),
  },
  makeRememberTool(memory),
];

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "harness", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const TOOL_NAMES = DEMO_TOOLS.map((t) => t.name).join(", ");

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run_agent",
      description:
        "Run a prompt through an open-source LLM (Llama 3.3 70B) using the tool-use harness. " +
        "Delegate cheap/repetitive subtasks to avoid burning Claude tokens. " +
        `The agent has access to: ${TOOL_NAMES}. ` +
        "If a codebase index exists (.harness-index.json), relevant code is auto-injected as context.",
      inputSchema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description: "The task to send to the open model.",
          },
          model: {
            type: "string",
            description: "Optional model override (default: llama-3.3-70b-instruct).",
          },
          system_prompt: {
            type: "string",
            description: "Optional extra system context.",
          },
          use_codebase_context: {
            type: "boolean",
            description: "If true (default), inject relevant code chunks from the index as context.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "search_code",
      description:
        "Semantic search over the indexed codebase. Returns the most relevant code chunks for a query. " +
        "Requires the index to be built first with build_index.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Natural language or code search query." },
          top_k: { type: "number", description: "Number of results to return (default 5)." },
        },
        required: ["query"],
      },
    },
    {
      name: "build_index",
      description:
        "Build or rebuild the semantic codebase index for a directory. " +
        "Run this once before using search_code or codebase context in run_agent. " +
        "Uses text-embedding-3-small via OpenRouter. Takes ~10-30s for a typical project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          directory: {
            type: "string",
            description: "Directory to index (default: current working directory).",
          },
        },
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  // ── search_code ──────────────────────────────────────────────────────────────
  if (toolName === "search_code") {
    const { query, top_k } = request.params.arguments as { query: string; top_k?: number };
    if (!codebaseIndex.isBuilt()) {
      return {
        content: [{
          type: "text",
          text: "No codebase index found. Run build_index first.",
        }],
      };
    }
    const results = await codebaseIndex.search(query, top_k ?? 5);
    return {
      content: [{ type: "text", text: results ?? "No relevant code found." }],
    };
  }

  // ── build_index ──────────────────────────────────────────────────────────────
  if (toolName === "build_index") {
    const { directory } = request.params.arguments as { directory?: string };
    const dir = directory ?? process.cwd();
    process.env.HARNESS_EMBEDDING_MODEL = "openai/text-embedding-3-small";
    const start = Date.now();
    const { chunks, files } = await codebaseIndex.build(dir);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return {
      content: [{
        type: "text",
        text: `Index built: ${files} files, ${chunks} chunks in ${elapsed}s. Saved to ${INDEX_PATH}.`,
      }],
    };
  }

  // ── run_agent ────────────────────────────────────────────────────────────────
  if (toolName !== "run_agent") {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const { prompt, model, system_prompt, use_codebase_context = true } = request.params.arguments as {
    prompt: string;
    model?: string;
    system_prompt?: string;
    use_codebase_context?: boolean;
  };

  const contextProviders = [
    memory.asContextProvider(),
    ...(use_codebase_context && codebaseIndex.isBuilt()
      ? [codebaseSearchProvider(codebaseIndex, prompt)]
      : []),
  ];

  const result = await harness.run({
    model: model ?? DEFAULT_MODEL,
    tools: DEMO_TOOLS,
    systemPrompt: system_prompt,
    messages: [{ role: "user", content: prompt }],
    contextProviders,
  });

  // Auto-learn from this run (tool sequences, context pressure signals)
  memory.learnFromRun(result, prompt.slice(0, 120));

  const lastMessage = [...result.messages]
    .reverse()
    .find((m) => m.role === "assistant");

  const answer =
    lastMessage && "content" in lastMessage && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "(no text response)";

  const costLine = result.cost
    ? `\n\n---\n_Cost: ${formatCost(result.cost)} · ${result.turns} turn(s) · ${result.toolCallsMade} tool call(s) · model: ${model ?? DEFAULT_MODEL}_`
    : "";

  return {
    content: [{ type: "text", text: answer + costLine }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
