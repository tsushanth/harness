import type { ToolDefinition } from "../types.js";

export interface EvalCase {
  id: string;
  description: string;
  userMessage: string;
  tools: ToolDefinition[];
  expect: {
    toolsCalled?: string[];
    args?: Record<string, Record<string, unknown>>;
    answerContains?: string[];
    answerJudge?: string;
  };
}

export interface EvalCaseResult {
  id: string;
  description: string;
  passed: boolean;
  scores: {
    toolsCalled: boolean | null;
    argMatch: boolean | null;
    answerMatch: boolean | null;
    judgeReason?: string;
  };
  finalAnswer: string;
  turns: number;
  toolCallsMade: number;
  usedStrictMode: boolean;
  errors: string[];
}

// Result for one case across N runs
export interface EvalCaseMultiResult {
  id: string;
  description: string;
  runs: number;
  passCount: number;          // how many runs passed
  passed: boolean;            // majority vote (>= ceil(runs/2))
  passRate: number;           // passCount / runs
  representative: EvalCaseResult; // last passing run, or last run if all fail
}

export interface EvalSuiteResult {
  model: string;
  runs: number;               // runs per case
  total: number;              // number of cases
  passed: number;             // cases that passed majority vote
  passRate: number;
  cases: EvalCaseMultiResult[];
  durationMs: number;
}
