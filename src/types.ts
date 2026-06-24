import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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
  systemPrompt?: string; // merged with harness tool-use instructions
  collector?: import("./finetune.js").FineTuneCollector;
}

export interface RunResult {
  messages: Message[];
  turns: number;
  toolCallsMade: number;
  usedStrictMode: boolean;
}
