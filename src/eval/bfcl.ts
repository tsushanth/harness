/**
 * BFCL (Berkeley Function Calling Leaderboard) eval runner.
 *
 * Runs a sample of BFCL v3 test cases through the harness and scores
 * using AST argument matching (same logic as the official evaluator).
 *
 * Supported categories: simple, multiple, parallel
 */
import OpenAI from "openai";
import { Harness } from "../core.js";
import type { ToolDefinition, Message } from "../types.js";

// ── BFCL data types ───────────────────────────────────────────────────────────

interface BfclFunction {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string; items?: unknown; enum?: unknown[] }>;
    required?: string[];
  };
}

interface BfclQuestion {
  id: string;
  question: Array<Array<{ role: string; content: string }>>;
  function: BfclFunction[];
}

// ground_truth: array of possible correct answers (each is an object mapping fn_name -> args)
interface BfclAnswer {
  id: string;
  ground_truth: Array<Record<string, Record<string, unknown[]>>>;
}

export interface BfclResult {
  id: string;
  passed: boolean;
  expected: string;      // fn_name(args)
  got: string;           // fn_name(args) or "no_tool_call"
  reason?: string;
}

export interface BfclSuiteResult {
  category: string;
  model: string;
  total: number;
  passed: number;
  accuracy: number;      // 0–1
  results: BfclResult[];
  totalCostUsd: number;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

const HF_BASE =
  "https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard/resolve/main";

async function fetchNdJson(url: string): Promise<unknown[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ── Schema conversion: BFCL "dict" type → JSON Schema ────────────────────────

function bfclParamsToJsonSchema(
  params: BfclFunction["parameters"]
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(params.properties)) {
    const t = val.type === "dict" ? "object" : val.type === "float" ? "number" : val.type;
    props[key] = {
      type: t,
      description: val.description ?? "",
      ...(val.items ? { items: val.items } : {}),
      ...(val.enum ? { enum: val.enum } : {}),
    };
  }
  return {
    type: "object",
    properties: props,
    required: params.required ?? [],
  };
}

// ── Scoring: AST argument matching ───────────────────────────────────────────
// ground_truth arg values are arrays of accepted values (["units", ""] means either is ok)

function argMatches(got: unknown, accepted: unknown[]): boolean {
  for (const a of accepted) {
    if (a === "" || a === null || a === undefined) return true; // optional / default
    if (typeof a === "number" && typeof got === "number" && Math.abs(a - got) < 1e-6) return true;
    if (String(a) === String(got)) return true;
    // Array args
    if (Array.isArray(a) && Array.isArray(got) && JSON.stringify(a) === JSON.stringify(got)) return true;
  }
  return false;
}

function scoreCall(
  calledName: string,
  calledArgs: Record<string, unknown>,
  groundTruth: Array<Record<string, Record<string, unknown[]>>>
): boolean {
  for (const possibility of groundTruth) {
    for (const [fnName, expectedArgs] of Object.entries(possibility)) {
      // Name match (BFCL uses dots for namespacing, models strip/keep them)
      const nameOk =
        calledName === fnName ||
        calledName.replace(/\./g, "_") === fnName.replace(/\./g, "_");
      if (!nameOk) continue;

      // All required args must match
      let argsOk = true;
      for (const [argKey, acceptedVals] of Object.entries(expectedArgs)) {
        const gotVal = calledArgs[argKey];
        if (!argMatches(gotVal, acceptedVals)) {
          argsOk = false;
          break;
        }
      }
      if (argsOk) return true;
    }
  }
  return false;
}

// ── Main runner ───────────────────────────────────────────────────────────────

export interface BfclRunOptions {
  model: string;
  client: OpenAI;
  /** Category to test: "simple" | "multiple" | "parallel" (default "simple") */
  category?: "simple" | "multiple" | "parallel";
  /** Max test cases to run (default 50 to keep costs low) */
  limit?: number;
  /** Callback for per-case progress */
  onProgress?: (done: number, total: number, result: BfclResult) => void;
}

export async function runBfcl(opts: BfclRunOptions): Promise<BfclSuiteResult> {
  const { model, client, category = "simple", limit = 50, onProgress } = opts;

  const [questions, answers] = await Promise.all([
    fetchNdJson(`${HF_BASE}/BFCL_v3_${category}.json`) as Promise<BfclQuestion[]>,
    fetchNdJson(`${HF_BASE}/possible_answer/BFCL_v3_${category}.json`) as Promise<BfclAnswer[]>,
  ]);

  const answerMap = new Map(answers.map((a) => [a.id, a.ground_truth]));
  const sample = questions.slice(0, limit);

  const harness = new Harness({ client, model });
  const results: BfclResult[] = [];
  let totalCost = 0;

  for (let i = 0; i < sample.length; i++) {
    const q = sample[i]!;
    const groundTruth = answerMap.get(q.id);
    if (!groundTruth) continue;

    // Build tools with a recording fn (BFCL tests tool selection, not execution)
    const calledTools: Array<{ name: string; args: Record<string, unknown> }> = [];
    const tools: ToolDefinition[] = q.function.map((fn) => ({
      name: fn.name,
      description: fn.description,
      parameters: bfclParamsToJsonSchema(fn.parameters),
      fn: (args) => {
        calledTools.push({ name: fn.name, args });
        return { result: "ok" };
      },
    }));

    const messages: Message[] = q.question[0]!.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    let passed = false;
    let gotStr = "no_tool_call";

    try {
      const run = await harness.run({ messages, tools, maxTurns: 3 });
      if (run.cost) totalCost += run.cost.totalCost;

      if (calledTools.length > 0) {
        const first = calledTools[0]!;
        gotStr = `${first.name}(${JSON.stringify(first.args)})`;
        passed = scoreCall(first.name, first.args, groundTruth);
      }
    } catch {
      gotStr = "error";
    }

    // Format expected for display
    const firstExpected = Object.entries(groundTruth[0] ?? {})[0];
    const expectedStr = firstExpected
      ? `${firstExpected[0]}(${JSON.stringify(
          Object.fromEntries(
            Object.entries(firstExpected[1]).map(([k, v]) => [k, v[0]])
          )
        )})`
      : "unknown";

    const result: BfclResult = { id: q.id, passed, expected: expectedStr, got: gotStr };
    results.push(result);
    onProgress?.(i + 1, sample.length, result);
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    category,
    model,
    total: results.length,
    passed,
    accuracy: passed / results.length,
    results,
    totalCostUsd: totalCost,
  };
}
