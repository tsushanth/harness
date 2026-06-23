import type { ToolDefinition } from "../types.js";

export interface EvalCase {
  id: string;
  description: string;
  userMessage: string;
  tools: ToolDefinition[];
  expect: {
    // Which tools should have been called (in any order)
    toolsCalled?: string[];
    // Argument matchers: { toolName: { argKey: expectedValue } }
    args?: Record<string, Record<string, unknown>>;
    // Literal substring check (fast, no API call)
    answerContains?: string[];
    // LLM-as-judge: natural language criteria evaluated by a judge model
    answerJudge?: string;
  };
}

export interface EvalCaseResult {
  id: string;
  description: string;
  passed: boolean;
  scores: {
    toolsCalled: boolean | null;  // null = not checked
    argMatch: boolean | null;
    answerMatch: boolean | null;
    judgeReason?: string;         // set when answerJudge was used
  };
  finalAnswer: string;
  turns: number;
  toolCallsMade: number;
  usedStrictMode: boolean;
  errors: string[];
}

export interface EvalSuiteResult {
  model: string;
  total: number;
  passed: number;
  passRate: number;
  cases: EvalCaseResult[];
  durationMs: number;
}
