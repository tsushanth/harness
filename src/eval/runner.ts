import OpenAI from "openai";
import { Harness } from "../core.js";
import { judgeAnswer } from "./judge.js";
import type {
  EvalCase,
  EvalCaseResult,
  EvalCaseMultiResult,
  EvalSuiteResult,
} from "./types.js";

const JUDGE_MODEL = "openai/gpt-4o-mini";

export async function runEval(
  cases: EvalCase[],
  model: string,
  client: OpenAI,
  runsPerCase = 1
): Promise<EvalSuiteResult> {
  const harness = new Harness({ client, model });
  const start = Date.now();

  const multiResults: EvalCaseMultiResult[] = await Promise.all(
    cases.map((c) => runCaseMulti(c, harness, client, runsPerCase))
  );

  const passed = multiResults.filter((r) => r.passed).length;

  return {
    model,
    runs: runsPerCase,
    total: cases.length,
    passed,
    passRate: passed / cases.length,
    cases: multiResults,
    durationMs: Date.now() - start,
  };
}

async function runCaseMulti(
  c: EvalCase,
  harness: Harness,
  client: OpenAI,
  runs: number
): Promise<EvalCaseMultiResult> {
  // Run all N trials in parallel
  const trials = await Promise.all(
    Array.from({ length: runs }, () => runCase(c, harness, client))
  );

  const passCount = trials.filter((t) => t.passed).length;
  const majority = Math.ceil(runs / 2);
  const passed = passCount >= majority;

  // Representative: prefer a passing run for the report; fall back to last
  const representative =
    trials.find((t) => t.passed) ?? trials[trials.length - 1]!;

  return {
    id: c.id,
    description: c.description,
    runs,
    passCount,
    passed,
    passRate: passCount / runs,
    representative,
  };
}

async function runCase(
  c: EvalCase,
  harness: Harness,
  client: OpenAI
): Promise<EvalCaseResult> {
  const errors: string[] = [];
  let finalAnswer = "";
  let turns = 0;
  let toolCallsMade = 0;
  let usedStrictMode = false;

  const calledTools: string[] = [];
  const calledArgs: Record<string, Record<string, unknown>> = {};
  const toolResultsLog: Record<string, unknown> = {};

  const instrumentedTools = c.tools.map((t) => ({
    ...t,
    fn: async (args: Record<string, unknown>) => {
      calledTools.push(t.name);
      calledArgs[t.name] = args;
      const result = await t.fn(args);
      toolResultsLog[t.name] = result;
      return result;
    },
  }));

  try {
    const result = await harness.run({
      messages: [{ role: "user", content: c.userMessage }],
      tools: instrumentedTools,
      maxTurns: 8,
      maxRetries: 3,
      maxTokens: 1024,
    });

    turns = result.turns;
    toolCallsMade = result.toolCallsMade;
    usedStrictMode = result.usedStrictMode;

    const lastAssistant = [...result.messages]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" &&
          "content" in m &&
          typeof m.content === "string"
      );
    finalAnswer =
      lastAssistant && "content" in lastAssistant
        ? (lastAssistant.content as string)
        : "";
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const scores = await scoreCase(
    c,
    calledTools,
    calledArgs,
    toolResultsLog,
    finalAnswer,
    errors,
    client
  );

  return {
    id: c.id,
    description: c.description,
    passed:
      scores.toolsCalled !== false &&
      scores.argMatch !== false &&
      scores.answerMatch !== false &&
      errors.length === 0,
    scores,
    finalAnswer,
    turns,
    toolCallsMade,
    usedStrictMode,
    errors,
  };
}

async function scoreCase(
  c: EvalCase,
  calledTools: string[],
  calledArgs: Record<string, Record<string, unknown>>,
  toolResultsLog: Record<string, unknown>,
  finalAnswer: string,
  errors: string[],
  client: OpenAI
): Promise<EvalCaseResult["scores"]> {
  if (errors.length > 0) {
    return { toolsCalled: false, argMatch: false, answerMatch: false };
  }

  const toolsCalled =
    c.expect.toolsCalled != null
      ? c.expect.toolsCalled.every((name) => calledTools.includes(name))
      : null;

  const argMatch =
    c.expect.args != null
      ? Object.entries(c.expect.args).every(([toolName, expectedArgs]) => {
          const actual = calledArgs[toolName];
          if (!actual) return false;
          return Object.entries(expectedArgs).every(
            ([k, v]) => JSON.stringify(actual[k]) === JSON.stringify(v)
          );
        })
      : null;

  if (c.expect.answerJudge != null) {
    const judgeResult = await judgeAnswer(
      client,
      JUDGE_MODEL,
      c.userMessage,
      toolResultsLog,
      finalAnswer,
      c.expect.answerJudge
    );
    return {
      toolsCalled,
      argMatch,
      answerMatch: judgeResult.passed,
      judgeReason: judgeResult.reason,
    };
  }

  const answerMatch =
    c.expect.answerContains != null
      ? c.expect.answerContains.every((phrase) =>
          finalAnswer.toLowerCase().includes(phrase.toLowerCase())
        )
      : null;

  return { toolsCalled, argMatch, answerMatch };
}
