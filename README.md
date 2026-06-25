# harness

A thin, provider-agnostic tool use harness for open LLMs.

Makes Llama 3.3 70B, Qwen 2.5, Mistral, and others behave like frontier models on tool use — without changing the model or the provider.

## The problem

Frontier models (GPT-4o, Claude) are reliable at tool use because of RLHF tuning and strict output enforcement at the API level. Open models served via Ollama, Groq, Together AI, or OpenRouter are not — they emit malformed JSON, pass wrong types, omit required fields, and loop when they should stop.

The harness fixes this with three layers:

1. **System prompt** — model-family-specific instructions for when to call tools, when to stop, and how to handle parallel vs sequential chains
2. **Schema-aware repair loop** — validates tool call arguments against the JSON schema after parsing; re-prompts with specific violations (`missing required field: city`, `unit must be one of: celsius, fahrenheit`) instead of generic retries
3. **Type coercion** — silently fixes small mismatches (`"true"` → `true`, `"42"` → `42`) before escalating to a repair prompt

For providers that support OpenAI's `strict: true` (GPT-4o family), the harness auto-detects this and skips the repair loop entirely — the model is constrained at decode time.

## Install

```bash
npm install @tsushanth/harness
```

## Quickstart

```typescript
import OpenAI from "openai";
import { Harness } from "@tsushanth/harness";

const client = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1", // any OpenAI-compatible endpoint
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
      fn: async ({ city }) => {
        return { city, temperature: 22, condition: "sunny" };
      },
    },
  ],
});

console.log(result.usage);  // { promptTokens, completionTokens, totalTokens }
console.log(result.cost);   // { inputCost, outputCost, totalCost } in USD
```

## Works with any provider

Point `baseURL` at any OpenAI-compatible endpoint:

```bash
# Groq (free tier)
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=gsk_...
MODEL=llama-3.3-70b-versatile

# Ollama (local)
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
MODEL=llama3.3

# OpenRouter (multi-provider)
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
MODEL=meta-llama/llama-3.3-70b-instruct

# Together AI
OPENAI_BASE_URL=https://api.together.xyz/v1
OPENAI_API_KEY=...
MODEL=meta-llama/Llama-3-70b-chat-hf
```

## Options

```typescript
const result = await harness.run({
  messages,
  tools,
  maxTurns: 10,            // max tool call rounds (default: 10)
  maxRetries: 3,           // repair attempts per malformed tool call (default: 3)
  maxTokens: 1024,         // cap tokens per turn
  maxToolResultChars: 4000,// truncate tool results to avoid context blowout
  maxConcurrentTools: 5,   // parallel tool call cap (default: 5)
  signal: abortController.signal, // cancellation
  systemPrompt: "...",     // prepended to harness instructions
});

// RunResult fields
result.usage;       // { promptTokens, completionTokens, totalTokens }
result.cost;        // { inputCost, outputCost, totalCost } in USD, or null
result.wasPruned;   // true if context overflow pruning fired
result.usedStrictMode; // true if OpenAI strict mode was used
```

## BFCL Benchmark

Evaluated on [Berkeley Function Calling Leaderboard v3](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard) — the standard benchmark for LLM tool use.

### Simple (single function call)

| Model | Accuracy | Cost / 50 cases |
|---|---|---|
| **Llama 3.3 70B + harness** | **84%** | $0.056 |
| GPT-4o-mini | 58% | $0.158 |

Llama 3.3 70B with the harness scores **26 points higher** than GPT-4o-mini at **3× lower cost**. GPT-4o-mini's failures are largely due to OpenRouter rejecting dotted tool names (e.g. `math.factorial`) at the API level — the harness repair loop handles these gracefully.

### Multiple (select from N functions)

_Running..._

### Parallel (call multiple functions in one turn)

_Running..._

Run it yourself:

```bash
OPENROUTER_API_KEY=... npx tsx scripts/run-bfcl.ts meta-llama/llama-3.3-70b-instruct simple 50
OPENROUTER_API_KEY=... npx tsx scripts/run-bfcl.ts meta-llama/llama-3.3-70b-instruct multiple 50
OPENROUTER_API_KEY=... npx tsx scripts/run-bfcl.ts meta-llama/llama-3.3-70b-instruct parallel 50
```

## Internal eval suite

The repo also ships a 15-case eval suite for rapid iteration during development:

```bash
OPENAI_BASE_URL=... OPENAI_API_KEY=... MODEL=llama-3.3-70b-versatile npm run eval
```

### Results (3 runs, majority vote, OpenRouter)

| Model | Score | Notes |
|---|---|---|
| `anthropic/claude-3-haiku` | 14/15 (93%) | 2 flaky cases |
| `openai/gpt-4o-mini` | 14/15 (93%) | 1 flaky case |
| `meta-llama/llama-3.3-70b-instruct` | 13/15 (87%) | 4 flaky, 1 hard fail |

## Production features

- **Retry with exponential backoff** — retries on 429/500/502/503/504 with full jitter
- **Tool result truncation** — caps results at 4k chars before injecting into context
- **Token counting + cost tracking** — accumulated per run, model pricing table built in
- **Context overflow protection** — prunes old tool results and assistant turns at 80% of model's context limit
- **Concurrency cap** — limits parallel tool dispatch (default 5)
- **AbortSignal cancellation** — cancel in-flight runs via standard `AbortController`
- **Streaming** — `harness.stream(options)` returns `AsyncGenerator<StreamEvent>`
- **Fine-tuning flywheel** — successful repair loops exported as JSONL training examples

## MCP server

The repo includes an MCP server that exposes the harness as a `run_agent` tool inside Claude Code. This lets you delegate cheap subtasks to Llama 70B mid-conversation.

```bash
claude mcp add harness \
  -e OPENROUTER_API_KEY=sk-or-... \
  -e BRAVE_SEARCH_API_KEY=BSA... \
  -- npx tsx /path/to/harness/mcp/server.ts
```

The agent has access to: `web_search` (Brave/Tavily), `read_file`, `write_file`, `shell`, `calculate`, `get_current_time`.

## Architecture

```
src/
  core.ts        — Harness class, run loop, context pruning
  prompt.ts      — System prompt builder, model-family detection
  repair.ts      — Malformed JSON + schema repair loop
  schema.ts      — AJV-based JSON schema validator with type coercion
  structured.ts  — Strict mode detection and schema enforcement for GPT-4o
  tools.ts       — Tool registry, OpenAI format conversion, dispatch
  retry.ts       — Exponential backoff + jitter
  context.ts     — Context window management and message pruning
  cost.ts        — Token cost estimation, model pricing table
  types.ts       — Shared types
  eval/
    bfcl.ts      — BFCL v3 benchmark runner (downloads live from HuggingFace)
    suite.ts     — 15-case internal eval suite
    runner.ts    — Multi-run eval runner with majority vote
    judge.ts     — LLM-as-judge answer scorer
    report.ts    — Terminal report + side-by-side comparison
mcp/
  server.ts      — MCP server for Claude Code integration
scripts/
  run-bfcl.ts   — CLI for running BFCL benchmark
```

## License

MIT
