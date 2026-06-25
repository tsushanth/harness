import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { CostEstimate } from "./cost.js";

export type Message = ChatCompletionMessageParam;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  fn: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  result: unknown;
  error?: string;
}

export interface RunOptions {
  messages: Message[];
  tools: ToolDefinition[];
  maxTurns?: number;
  maxRetries?: number;
  model?: string;
  maxTokens?: number;
  maxToolResultChars?: number; // max chars per tool result injected into context (default 4000)
  maxConcurrentTools?: number; // max parallel tool calls per turn (default 5)
  signal?: AbortSignal;         // cancellation
  systemPrompt?: string; // merged with harness tool-use instructions
  collector?: import("./finetune.js").FineTuneCollector;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RunResult {
  messages: Message[];
  turns: number;
  toolCallsMade: number;
  usedStrictMode: boolean;
  usage: TokenUsage;          // accumulated across all turns
  cost: CostEstimate | null;  // null when model isn't in pricing table
  wasPruned: boolean;         // true if context overflow pruning fired
}
