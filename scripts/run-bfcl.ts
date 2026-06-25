#!/usr/bin/env npx tsx
/**
 * Run BFCL benchmark against a model via the harness.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... npx tsx scripts/run-bfcl.ts [model] [category] [limit]
 *
 * Examples:
 *   npx tsx scripts/run-bfcl.ts                                       # llama 70b, simple, 50 cases
 *   npx tsx scripts/run-bfcl.ts meta-llama/llama-3.3-70b-instruct simple 100
 *   npx tsx scripts/run-bfcl.ts gpt-4o-mini simple 100               # baseline comparison
 */
import OpenAI from "openai";
import { runBfcl } from "../src/eval/bfcl.js";
import type { BfclResult } from "../src/eval/bfcl.js";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const model = process.argv[2] ?? "meta-llama/llama-3.3-70b-instruct";
const category = (process.argv[3] ?? "simple") as "simple" | "multiple" | "parallel";
const limit = parseInt(process.argv[4] ?? "50", 10);
const usePlan = process.argv[5] === "--plan";

const client = OPENAI_KEY
  ? new OpenAI({ apiKey: OPENAI_KEY })
  : OPENROUTER_KEY
  ? new OpenAI({ apiKey: OPENROUTER_KEY, baseURL: "https://openrouter.ai/api/v1" })
  : new OpenAI({ apiKey: GROQ_KEY, baseURL: "https://api.groq.com/openai/v1" });

console.log(`\nBFCL v3 — ${category} — ${model}${usePlan ? " [plan-then-execute]" : ""}`);
console.log(`Running ${limit} cases...\n`);

const startMs = Date.now();

const suite = await runBfcl({
  model,
  client,
  category,
  limit,
  plan: usePlan,
  onProgress: (done, total, result: BfclResult) => {
    const icon = result.passed ? "✓" : "✗";
    process.stdout.write(
      `  [${String(done).padStart(3)}/${total}] ${icon} ${result.id}\n`
    );
    if (!result.passed) {
      process.stdout.write(`         expected: ${result.expected}\n`);
      process.stdout.write(`         got:      ${result.got}\n`);
    }
  },
});

const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BFCL Results — ${suite.category}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Model    : ${suite.model}
Cases    : ${suite.total}
Passed   : ${suite.passed}
Accuracy : ${(suite.accuracy * 100).toFixed(1)}%
Cost     : $${suite.totalCostUsd.toFixed(4)}
Time     : ${elapsed}s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
