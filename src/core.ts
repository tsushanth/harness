import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import type { RunOptions, RunResult, Message, ToolCall, TokenUsage } from "./types.js";
import { toOpenAITools, dispatch, serializeToolResult } from "./tools.js";
import { repairToolCall } from "./repair.js";
import { buildSystemPrompt, detectModelFamily } from "./prompt.js";
import { supportsStrictTools, toStrictTools } from "./structured.js";
import { streamRun, type StreamEvent } from "./stream.js";
import { withRetry } from "./retry.js";

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export class Harness {
  private client: OpenAI;
  private defaultModel: string;

  constructor(options: { client: OpenAI; model?: string }) {
    this.client = options.client;
    this.defaultModel = options.model ?? "gpt-4o";
  }

  async run(options: RunOptions): Promise<RunResult> {
    const {
      tools,
      maxTurns = 10,
      maxRetries = 3,
      model = this.defaultModel,
      maxTokens,
      maxToolResultChars,
      collector,
    } = options;

    const family = detectModelFamily(model);

    const messages: Message[] = [...options.messages];
    const systemIndex = messages.findIndex((m) => m.role === "system");
    const existingSystem =
      systemIndex >= 0
        ? (messages[systemIndex] as { role: "system"; content: string }).content
        : undefined;
    const systemPrompt = buildSystemPrompt(tools, family, existingSystem);

    if (systemIndex >= 0) {
      messages[systemIndex] = { role: "system", content: systemPrompt };
    } else {
      messages.unshift({ role: "system", content: systemPrompt });
    }

    const useStrict = supportsStrictTools(model);
    const openAITools = useStrict ? toStrictTools(tools) : toOpenAITools(tools);
    let turns = 0;
    let toolCallsMade = 0;
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    while (turns < maxTurns) {
      const response = await withRetry(() =>
        this.client.chat.completions.create({
          model,
          messages,
          tools: openAITools,
          tool_choice: "auto",
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
        })
      );

      if (response.usage) {
        usage.promptTokens += response.usage.prompt_tokens;
        usage.completionTokens += response.usage.completion_tokens;
        usage.totalTokens += response.usage.total_tokens;
      }

      const choice = response.choices[0];
      if (!choice) break;

      const message = choice.message;

      const fnToolCalls = (message.tool_calls ?? []).filter(
        (tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function"
      );

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        ...(fnToolCalls.length > 0 ? { tool_calls: fnToolCalls } : {}),
      });

      turns++;

      if (fnToolCalls.length === 0) break;

      // Concurrency cap: run at most N tool calls in parallel to avoid
      // hammering rate-limited or slow tool implementations.
      const concurrencyLimit = options.maxConcurrentTools ?? 5;
      const toolResults = await runWithConcurrencyLimit(
        fnToolCalls,
        concurrencyLimit,
        async (tc) => {
          let args: Record<string, unknown>;

          const toolDef = tools.find((t) => t.name === tc.function.name);
          try {
            args = useStrict
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : await repairToolCall(
                  this.client,
                  model,
                  messages,
                  tools,
                  tc.function.arguments,
                  "initial parse",
                  maxRetries,
                  toolDef?.parameters,
                  tc.function.name,
                  collector
                );
          } catch (err) {
            return {
              id: tc.id,
              name: tc.function.name,
              result: null,
              error: err instanceof Error ? err.message : String(err),
            };
          }

          const call: ToolCall = {
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          };

          toolCallsMade++;
          return dispatch(call, tools);
        }
      );

      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: tr.id,
          content: tr.error
            ? `Error: ${tr.error}`
            : serializeToolResult(tr.result, maxToolResultChars),
        });
      }
    }

    return { messages, turns, toolCallsMade, usedStrictMode: useStrict, usage };
  }

  stream(options: RunOptions): AsyncGenerator<StreamEvent> {
    const model = options.model ?? this.defaultModel;
    return streamRun(this.client, { ...options, model });
  }
}
