# harness

**Provider-agnostic tool use harness for open LLMs.**

Llama 3.3 70B, Qwen 2.5, Mistral, and others behave like frontier models on tool use — no model swap, no cloud lock-in, no per-seat pricing.

---

## Why this exists

GPT-4o and Claude are reliable at tool use because they're tuned for it and constrained at decode time. Open models served via Ollama, Groq, Together AI, or OpenRouter are not. They emit malformed JSON, pass wrong types, omit required fields, hallucinate tool names, and loop when they should stop.

The standard workaround is to pick a frontier model for anything that touches tools. That means:

- **Cost** — GPT-4o costs 4–16× more than Llama 3.3 70B on the same workload
- **Privacy** — every prompt goes to OpenAI or Anthropic
- **Lock-in** — switching providers requires re-testing all tool call behavior

The harness fixes the reliability gap without touching the model. It's a thin layer that:

1. **Tunes the system prompt** per model family (llama, qwen, mistral, gemma) — when to call tools, when to stop, how to handle chains
2. **Validates tool call arguments** against the JSON schema after parsing — catches wrong types, missing fields, out-of-range values
3. **Repairs inline** — re-prompts with the specific violation (`missing required field: city`, `unit must be one of: celsius, fahrenheit`) instead of generic retries
4. **Coerces silently** — fixes small mismatches (`"true"` → `true`, `"42"` → `42`) before escalating to a repair prompt

For providers that support strict mode (GPT-4o family), the harness detects this and skips repair entirely — the model is constrained at decode time.

**Benchmark result on BFCL v3 (Berkeley Function Calling Leaderboard):**

| Model | Accuracy (simple) | Cost / 50 cases |
|---|---|---|
| Llama 3.3 70B + harness | **84%** | $0.056 |
| GPT-4o-mini (baseline) | 58% | $0.158 |

84% vs 58% accuracy. 3× lower cost. Same open-source model.

---

## What you can do with it

- **Drop-in replacement** — use it like an OpenAI client wrapper, works with any tool schema you already have
- **MCP server** — plug the harness into Claude Code as a `run_agent` tool; delegate cheap subtasks to Llama 70B mid-conversation without burning Claude tokens
- **Chat UI** — local web interface with real-time tool call visualization, codebase search, and cost tracking
- **Codebase indexing** — embed your repo with `text-embedding-3-small`, semantically search relevant code, inject it as context before the model sees the task (like Continue.dev's `@codebase`)
- **Eval benchmark** — run BFCL v3 on any model/provider with one command

---

## Install

```bash
npm install @tsushanth/harness
```

Or clone and run locally:

```bash
git clone https://github.com/tsushanth/harness
cd harness
npm install
```

---

## Quickstart

```typescript
import OpenAI from "openai";
import { Harness } from "@tsushanth/harness";

const client = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",   // any OpenAI-compatible endpoint
  apiKey: process.env.GROQ_API_KEY,
});

const harness = new Harness({ client, model: "llama-3.3-70b-versatile" });

const result = await harness.run({
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          unit: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["city"],
      },
      fn: async ({ city }) => ({ city, temperature: 22, condition: "sunny" }),
    },
  ],
});

console.log(result.usage);  // { promptTokens, completionTokens, totalTokens }
console.log(result.cost);   // { inputCost, outputCost, totalCost } in USD
```

---

## Providers

Point `baseURL` at any OpenAI-compatible endpoint:

```bash
# Groq — free tier, 10× faster than most hosted APIs
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=gsk_...
MODEL=llama-3.3-70b-versatile

# Ollama — fully local, no API key
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
MODEL=llama3.3

# OpenRouter — unified gateway, 200+ models
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
MODEL=meta-llama/llama-3.3-70b-instruct

# Together AI
OPENAI_BASE_URL=https://api.together.xyz/v1
OPENAI_API_KEY=...
MODEL=meta-llama/Llama-3-70b-chat-hf
```

---

## Web UI

A local chat interface that runs in your browser. Shows tool calls in real-time, tracks cost and token usage, manages the codebase index, and works with any provider.

**Start it:**

```bash
# Clone the repo (UI is not included in the npm package)
git clone https://github.com/tsushanth/harness && cd harness
npm install

# With OpenRouter
OPENROUTER_API_KEY=sk-or-... npm run ui

# With Groq
GROQ_API_KEY=gsk_... npm run ui

# With web search (Brave)
OPENROUTER_API_KEY=... BRAVE_SEARCH_API_KEY=BSA... npm run ui
```

Opens at `http://localhost:3737`.

**What the UI includes:**

- Chat window with Markdown rendering and collapsible tool call cards
- Live tool call visibility — see exactly what the model called, with what args, and what came back
- Model and provider selector (OpenRouter / Groq / Ollama)
- Optional system prompt field
- Codebase index panel — build, status, and semantic search without leaving the browser
- Token count and cost displayed per response
- Conversation memory — multi-turn context maintained across the session

**Tool call example** — you ask "what files changed in the last commit?", the model calls `shell(git log -1 --stat)`, you see the card expand with the command and output before the answer appears.

---

## MCP server (Claude Code integration)

The harness ships an MCP server so you can use it as a `run_agent` tool inside Claude Code. Use it to delegate cheap, repetitive subtasks to Llama 70B mid-conversation — searches, file reads, calculations — without burning Claude Sonnet/Opus tokens.

**Register it:**

```bash
claude mcp add harness \
  -e OPENROUTER_API_KEY=sk-or-... \
  -e BRAVE_SEARCH_API_KEY=BSA... \
  -- npx tsx /path/to/harness/mcp/server.ts
```

**Available tools inside Claude Code:**

| Tool | What it does |
|---|---|
| `run_agent` | Run a prompt through Llama 70B. Auto-injects relevant codebase chunks as context if an index exists. |
| `search_code` | Semantic search over the indexed codebase — returns the most relevant code chunks. |
| `build_index` | Build or rebuild the codebase index for a directory. |

The agent inside `run_agent` has access to: `web_search` (Brave), `read_file`, `write_file`, `shell`, `apply_diff`, `calculate`, `get_current_time`.

**Run it yourself:**

```bash
OPENROUTER_API_KEY=... npx tsx mcp/server.ts
```

---

## Codebase indexing

Index your repo once, then get relevant code injected automatically as context before every `run_agent` call — like Continue.dev's `@codebase` but without an IDE plugin.

**Build the index:**

```bash
# Index current directory
OPENROUTER_API_KEY=... HARNESS_EMBEDDING_MODEL=openai/text-embedding-3-small \
  npx tsx scripts/build-index.ts .

# Index a specific project
OPENAI_API_KEY=... npx tsx scripts/build-index.ts ~/projects/my-app
```

**Use it in code:**

```typescript
import OpenAI from "openai";
import { CodebaseIndex, codebaseSearchProvider, Harness } from "@tsushanth/harness";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const index = new CodebaseIndex(client);

// Build once (takes ~10-30s for a typical project)
await index.build(".");

// Use as a context provider — relevant chunks auto-injected before each run
const harness = new Harness({ client, model: "gpt-4o-mini" });
const result = await harness.run({
  messages: [{ role: "user", content: "How does the retry logic work?" }],
  tools: myTools,
  contextProviders: [codebaseSearchProvider(index, userQuery)],
});

// Or search directly
const results = await index.search("exponential backoff", 5);
```

Chunks are 60-line windows with 10-line overlap. Uses `text-embedding-3-small` via OpenAI or OpenRouter. Index stored as a flat JSON file (`.harness-index.json`) — no external database.

---

## All options

```typescript
const result = await harness.run({
  messages,
  tools,
  maxTurns: 10,                  // max tool call rounds (default: 10)
  maxRetries: 3,                 // repair attempts per malformed call (default: 3)
  maxTokens: 1024,               // cap tokens per turn
  maxToolResultChars: 4000,      // truncate tool results to avoid context blowout
  maxConcurrentTools: 5,         // parallel tool call cap (default: 5)
  signal: abortController.signal,// cancellation
  systemPrompt: "...",           // prepended to harness instructions
  plan: true,                    // decompose task into steps before dispatching
  contextProviders: [...],       // inject file/git/shell/codebase context
});

result.usage;          // { promptTokens, completionTokens, totalTokens }
result.cost;           // { inputCost, outputCost, totalCost } in USD, or null
result.wasPruned;      // true if context overflow pruning fired
result.usedStrictMode; // true if OpenAI strict mode was used
result.turns;          // number of tool call rounds
result.toolCallsMade;  // total tool calls across all turns
```

---

## BFCL Benchmark

[Berkeley Function Calling Leaderboard v3](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard) — the standard accuracy benchmark for LLM tool use.

### Simple (single function call)

| Model | Accuracy | Cost / 50 cases |
|---|---|---|
| **Llama 3.3 70B + harness** | **84%** | $0.056 |
| GPT-4o-mini | 58% | $0.158 |

### Multiple (select correct function from N candidates)

| Model | Accuracy | Cost / 50 cases |
|---|---|---|
| **Llama 3.3 70B + harness** | **90%** | $0.079 |

### Parallel (call multiple functions in one turn)

| Mode | Accuracy | Cost / 50 cases |
|---|---|---|
| Llama 3.3 70B + harness | 34% | $0.050 |
| Llama 3.3 70B + harness + plan | 40% | $0.075 |

Parallel is the honest weak spot. The model frequently issues no tool call when the prompt requires multiple simultaneous calls. Planning (+6 points) helps but doesn't close the gap — BFCL parallel scores single-turn multi-call batching, while planning serializes across turns. For real agentic tasks, sequential execution of a correct plan is usually preferable to unreliable parallel batching.

**Run it yourself:**

```bash
OPENROUTER_API_KEY=... npx tsx scripts/run-bfcl.ts meta-llama/llama-3.3-70b-instruct simple 50
OPENROUTER_API_KEY=... npx tsx scripts/run-bfcl.ts meta-llama/llama-3.3-70b-instruct multiple 50
OPENROUTER_API_KEY=... npx tsx scripts/run-bfcl.ts meta-llama/llama-3.3-70b-instruct parallel 50 --plan
```

---

## Production features

| Feature | Details |
|---|---|
| Retry + backoff | Exponential backoff with full jitter on 429/500/502/503/504 |
| Tool result truncation | Caps results at 4k chars before injecting into context |
| Token counting | Accumulated per run from the API `usage` field |
| Cost tracking | Model pricing table built in, returns USD estimate per run |
| Context overflow | Prunes old tool results then assistant turns at 80% of the model's context limit |
| Concurrency cap | Limits parallel tool dispatch (default 5) |
| AbortSignal | Cancel in-flight runs via `AbortController` |
| Streaming | `harness.stream(options)` returns `AsyncGenerator<StreamEvent>` |
| Plan-then-execute | Decompose multi-step tasks before dispatching tools |
| Diff-based editing | `applyDiff()` applies unified diffs; safer than full file overwrites |
| Context providers | Inject file, git diff, directory tree, shell output, or codebase chunks before each run |
| Fine-tuning flywheel | Successful repair loops exported as JSONL training pairs |

---

## Architecture

```
src/
  core.ts            — Harness class, run loop, context pruning, cost tracking
  prompt.ts          — System prompt builder, model-family detection
  repair.ts          — Malformed JSON + schema repair loop
  schema.ts          — AJV-based validator with type coercion
  structured.ts      — Strict mode detection for GPT-4o
  tools.ts           — Tool registry, OpenAI format conversion, dispatch
  retry.ts           — Exponential backoff + jitter, AbortSignal support
  context.ts         — Context window management, message pruning
  cost.ts            — Token cost estimation, model pricing table
  planner.ts         — Plan-then-execute decomposition
  diff.ts            — Unified diff application (Myers algorithm)
  context-providers.ts — File, git, shell, and codebase context injection
  stream.ts          — Streaming run
  finetune.ts        — Fine-tuning data flywheel
  index/
    chunker.ts       — Walk directory, 60-line chunks with overlap
    embedder.ts      — OpenAI text-embedding-3-small, batched
    store.ts         — Flat JSON vector store, cosine similarity
    codebase.ts      — CodebaseIndex class (build + search)
  eval/
    bfcl.ts          — BFCL v3 runner (downloads live from HuggingFace)
    suite.ts         — 15-case internal eval suite
    runner.ts        — Multi-run eval with majority vote
ui/
  server.ts          — Express server, SSE streaming, chat + index API
  index.html         — Single-file chat UI (no build step)
mcp/
  server.ts          — MCP server for Claude Code integration
scripts/
  run-bfcl.ts       — CLI for BFCL benchmark
  build-index.ts    — CLI for building codebase index
```

---

## License

MIT
