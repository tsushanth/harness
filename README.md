# harness

**The free, open-source alternative to Continue.dev — without the IDE plugin.**

Use any open LLM (Llama, Qwen, Mistral) as a capable coding assistant with codebase search, file editing, web search, and shell access. No extension install. No subscription. No data leaving your machine except the model call.

---

## Continue.dev is great. Here's what harness does differently.

[Continue.dev](https://continue.dev) is a VS Code / JetBrains extension that wires open models into your editor. It's the best open-source IDE assistant available. But it has a hard constraint: **it lives inside an IDE**.

Harness is a library + server that gives you the same capabilities — codebase context, file editing, web search — as a TypeScript package you can embed anywhere: a web UI, a CI pipeline, an MCP tool inside Claude Code, a script, or your own app.

| | Continue.dev | harness |
|---|---|---|
| Codebase context (`@codebase`) | ✅ Vector search over repo | ✅ Same — `text-embedding-3-small`, flat JSON store |
| File read / write | ✅ Direct editor access | ✅ `read_file` / `write_file` / `apply_diff` tools |
| Diff-based editing | ✅ Inline diff UI | ✅ `applyDiff()` — unified diff, Myers algorithm |
| Web search | ✅ Via `@web` | ✅ Brave Search API |
| Shell execution | ✅ Terminal integration | ✅ `shell` tool |
| Plan before acting | ✅ Agent mode | ✅ `plan: true` — decomposes task into ordered steps |
| Works without IDE | ❌ Extension required | ✅ CLI, web UI, MCP server, or npm package |
| Embeddable in your own app | ❌ | ✅ `npm install @tsushanth/harness` |
| MCP server for Claude Code | ❌ | ✅ Ships with one |
| Cost tracking | ❌ | ✅ USD per run, built-in pricing table |
| Fine-tuning flywheel | ❌ | ✅ Repair loops exported as JSONL training pairs |
| License | Apache 2.0 | MIT |

The gap harness doesn't close: **autocomplete (fill-in-middle)** and **inline diff UI**. Those require IDE hooks. Everything else is here.

---

## Why open models need a harness

Frontier models (GPT-4o, Claude Sonnet) are reliable at tool use because they're RLHF-tuned for it and constrained at decode time. Open models served via Ollama, Groq, Together AI, or OpenRouter are not. They emit malformed JSON, pass wrong types, omit required fields, and loop when they should stop.

The harness fixes this with three layers — no model swap required:

1. **Model-family system prompt** — tailored instructions for llama, qwen, mistral, gemma: when to call tools, when to stop, how to handle multi-step chains
2. **Schema-aware repair loop** — validates arguments against the JSON schema; re-prompts with specific violations (`missing required field: city`, `unit must be one of: celsius, fahrenheit`)
3. **Silent type coercion** — fixes small mismatches (`"true"` → `true`, `"42"` → `42`) before escalating to a repair prompt

**BFCL v3 result (Berkeley Function Calling Leaderboard):**

| Model | Accuracy | Cost / 50 cases |
|---|---|---|
| **Llama 3.3 70B + harness** | **84%** | $0.056 |
| GPT-4o-mini (no harness) | 58% | $0.158 |

84% accuracy. 3× lower cost. Same open-source model, different reliability layer.

---

## Install

**As a library:**
```bash
npm install @tsushanth/harness
```

**Web UI + MCP server (clone the repo):**
```bash
git clone https://github.com/tsushanth/harness
cd harness
npm install
```

---

## Web UI

A local chat interface — the fastest way to try the harness.

```bash
# OpenRouter (200+ models)
OPENROUTER_API_KEY=sk-or-... npm run ui

# Groq (free tier, very fast)
GROQ_API_KEY=gsk_... npm run ui

# With web search
OPENROUTER_API_KEY=... BRAVE_SEARCH_API_KEY=BSA... npm run ui
```

Opens at **http://localhost:3737**.

**What's in the UI:**
- Chat with any open model — Llama 3.3 70B, Qwen 2.5, Mistral, Gemma
- **Collapsible tool call cards** — see exactly what function ran, with what args, and what came back, before the answer appears
- Provider + model selector (OpenRouter / Groq / Ollama)
- **Codebase index panel** — build the index, check status, semantic search, all without leaving the browser
- Token count + USD cost per response
- Multi-turn conversation memory

---

## MCP server (Claude Code)

Use the harness as a `run_agent` tool inside Claude Code. Delegate cheap subtasks to Llama 70B mid-conversation without burning Claude Sonnet/Opus tokens.

```bash
claude mcp add harness \
  -e OPENROUTER_API_KEY=sk-or-... \
  -e BRAVE_SEARCH_API_KEY=BSA... \
  -- npx tsx /path/to/harness/mcp/server.ts
```

Inside Claude Code you get three tools:

| Tool | What it does |
|---|---|
| `run_agent` | Run a prompt through Llama 70B with tool use. Auto-injects relevant codebase chunks if an index exists. |
| `search_code` | Semantic search over the indexed codebase. Returns relevant code chunks instantly. |
| `build_index` | Build or rebuild the `.harness-index.json` for any directory. |

---

## Codebase indexing (`@codebase` equivalent)

Index your repo once. Every subsequent `run_agent` call automatically gets the most relevant code chunks injected as context before the model sees the task — same as Continue's `@codebase`, no IDE required.

**Build the index:**
```bash
# Via OpenRouter
OPENROUTER_API_KEY=... HARNESS_EMBEDDING_MODEL=openai/text-embedding-3-small \
  npx tsx scripts/build-index.ts .

# Via OpenAI directly
OPENAI_API_KEY=... npx tsx scripts/build-index.ts .

# Or use the UI — click "Build index" in the sidebar
```

**Use in code:**
```typescript
import OpenAI from "openai";
import { CodebaseIndex, codebaseSearchProvider, Harness } from "@tsushanth/harness";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const index = new CodebaseIndex(client);

await index.build(".");  // one-time, ~10-30s for a typical project

const harness = new Harness({ client, model: "gpt-4o-mini" });
const result = await harness.run({
  messages: [{ role: "user", content: "How does the retry logic work?" }],
  tools: myTools,
  contextProviders: [codebaseSearchProvider(index, userQuery)],
});
```

60-line chunks, 10-line overlap, cosine similarity search. Stored as a flat JSON file — no database, no Docker, no infra.

---

## Quickstart (library)

```typescript
import OpenAI from "openai";
import { Harness } from "@tsushanth/harness";

const client = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
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

## Providers

```bash
# Groq — free tier, 10× faster latency
OPENAI_BASE_URL=https://api.groq.com/openai/v1  MODEL=llama-3.3-70b-versatile

# Ollama — fully local, no API key, no data leaves your machine
OPENAI_BASE_URL=http://localhost:11434/v1  MODEL=llama3.3

# OpenRouter — unified gateway for 200+ models
OPENAI_BASE_URL=https://openrouter.ai/api/v1  MODEL=meta-llama/llama-3.3-70b-instruct

# Together AI
OPENAI_BASE_URL=https://api.together.xyz/v1  MODEL=meta-llama/Llama-3-70b-chat-hf
```

---

## All options

```typescript
await harness.run({
  messages,
  tools,
  maxTurns: 10,                   // max tool call rounds (default: 10)
  maxRetries: 3,                  // repair attempts per malformed call (default: 3)
  maxTokens: 1024,                // cap tokens per turn
  maxToolResultChars: 4000,       // truncate tool results to avoid context blowout
  maxConcurrentTools: 5,          // parallel tool call cap (default: 5)
  signal: abortController.signal, // cancellation
  systemPrompt: "...",            // prepended to harness instructions
  plan: true,                     // decompose multi-step tasks before dispatching
  contextProviders: [...],        // inject file/git/shell/codebase context
});
```

---

## BFCL Benchmark

[Berkeley Function Calling Leaderboard v3](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard).

### Simple (single function call)
| Model | Accuracy | Cost / 50 |
|---|---|---|
| **Llama 3.3 70B + harness** | **84%** | $0.056 |
| GPT-4o-mini | 58% | $0.158 |

### Multiple (select correct function from N candidates)
| Model | Accuracy | Cost / 50 |
|---|---|---|
| **Llama 3.3 70B + harness** | **90%** | $0.079 |

### Parallel (call multiple functions in one turn)
| Mode | Accuracy | Cost / 50 |
|---|---|---|
| Llama 3.3 70B + harness | 34% | $0.050 |
| + plan-then-execute | 40% | $0.075 |

Parallel is the honest weak spot — the model frequently issues no call when the prompt requires simultaneous tool calls. Planning helps at the margins. For real agentic tasks, sequential execution of a correct plan beats unreliable parallel batching.

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
| Tool result truncation | Caps results at 4k chars to prevent context blowout |
| Token counting | Accumulated per run from the API `usage` field |
| Cost tracking | Model pricing table built in, returns USD per run |
| Context overflow | Prunes old tool results then assistant turns at 80% of context limit |
| Concurrency cap | Parallel tool dispatch cap (default 5) |
| AbortSignal | Cancel in-flight runs via `AbortController` |
| Streaming | `harness.stream(options)` → `AsyncGenerator<StreamEvent>` |
| Plan-then-execute | Decompose multi-step tasks before dispatching tools |
| Diff editing | `applyDiff()` — unified diff, safer than full file overwrites |
| Context providers | File, git diff, directory, shell output, codebase chunks |
| Fine-tuning flywheel | Repair loops exported as JSONL training pairs |

---

## Architecture

```
src/
  core.ts              — Harness class, run loop, pruning, cost tracking
  prompt.ts            — System prompt builder, model-family detection
  repair.ts            — Malformed JSON + schema repair loop
  schema.ts            — AJV validator with type coercion
  structured.ts        — Strict mode detection for GPT-4o
  tools.ts             — Tool registry, OpenAI format conversion, dispatch
  retry.ts             — Exponential backoff + jitter, AbortSignal
  context.ts           — Context window management, message pruning
  cost.ts              — Token cost estimation, model pricing table
  planner.ts           — Plan-then-execute decomposition
  diff.ts              — Unified diff application (Myers algorithm)
  context-providers.ts — File, git, shell, and codebase context injection
  stream.ts            — Streaming run
  finetune.ts          — Fine-tuning data flywheel
  index/
    chunker.ts         — Walk directory, 60-line chunks with overlap
    embedder.ts        — text-embedding-3-small, batched requests
    store.ts           — Flat JSON vector store, cosine similarity
    codebase.ts        — CodebaseIndex: build() + search()
ui/
  server.ts            — Express + SSE chat server, index API
  index.html           — Single-file chat UI (no build step)
mcp/
  server.ts            — MCP server for Claude Code integration
scripts/
  build-index.ts       — CLI: build codebase index
  run-bfcl.ts         — CLI: run BFCL v3 benchmark
```

---

## License

MIT
