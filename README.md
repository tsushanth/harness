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
        // call your actual weather API here
        return { city, temperature: 22, condition: "sunny" };
      },
    },
  ],
});

// result.messages contains the full conversation including tool calls
// result.usedStrictMode tells you which enforcement path was taken
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
  maxTurns: 10,      // max tool call rounds before stopping (default: 10)
  maxRetries: 3,     // repair attempts per malformed tool call (default: 3)
  maxTokens: 1024,   // cap tokens per turn (useful for budget-limited providers)
  systemPrompt: "You are a helpful assistant.", // prepended to harness instructions
});
```

## Eval suite

The repo ships an eval suite that measures tool use reliability across models on 15 cases covering:

- Basic tool dispatch and argument passing
- Parallel vs sequential multi-tool chains
- Error recovery
- Schema enforcement (enum values, required fields, type coercion)
- Adversarial cases (nested objects, boolean coercion, multi-tool partial failure)

```bash
# Single model
OPENAI_BASE_URL=... OPENAI_API_KEY=... MODEL=llama-3.3-70b-versatile npm run eval

# Compare models side-by-side
OPENAI_BASE_URL=... OPENAI_API_KEY=... \
  MODELS="meta-llama/llama-3.3-70b-instruct,openai/gpt-4o-mini" \
  npm run eval

# 3 runs per case with variance report (recommended)
RUNS=3 MODELS="..." npm run eval
```

### Results (3 runs, majority vote, OpenRouter)

| Model | Score | Notes |
|---|---|---|
| `anthropic/claude-3-haiku` | 14/15 (93%) | 2 flaky cases |
| `openai/gpt-4o-mini` | 14/15 (93%) | 1 flaky case |
| `meta-llama/llama-3.3-70b-instruct` | 13/15 (87%) | 4 flaky, 1 hard fail |

Llama has ~3x more variance than frontier models. The harness closes most of the gap — the remaining failures are genuine model capability limits, not harness bugs.

## Architecture

```
src/
  core.ts        — Harness class, run loop
  prompt.ts      — System prompt builder, model-family detection
  repair.ts      — Malformed JSON + schema repair loop
  schema.ts      — AJV-based JSON schema validator with type coercion
  structured.ts  — Strict mode detection and schema enforcement for GPT-4o
  tools.ts       — Tool registry, OpenAI format conversion, dispatch
  types.ts       — Shared types
  eval/
    suite.ts     — 15 baseline eval cases
    runner.ts    — Multi-run eval runner with majority vote
    judge.ts     — LLM-as-judge answer scorer
    report.ts    — Terminal report + side-by-side comparison
    run.ts       — CLI entry point
```

## License

MIT
