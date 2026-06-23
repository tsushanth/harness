import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import type { RunOptions, RunResult, Message, ToolCall } from "./types.js";
import { toOpenAITools, dispatch } from "./tools.js";
import { repairToolCall } from "./repair.js";
import { buildSystemPrompt, detectModelFamily } from "./prompt.js";
import { supportsStrictTools, toStrictTools } from "./structured.js";

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

    while (turns < maxTurns) {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        tools: openAITools,
        tool_choice: "auto",
      });

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

      const toolResults = await Promise.all(
        fnToolCalls.map(async (tc) => {
          let args: Record<string, unknown>;

          try {
            // Strict mode guarantees valid JSON — skip repair loop
            args = useStrict
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : await repairToolCall(
                  this.client,
                  model,
                  messages,
                  tools,
                  tc.function.arguments,
                  "initial parse",
                  maxRetries
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
        })
      );

      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: tr.id,
          content: tr.error
            ? `Error: ${tr.error}`
            : JSON.stringify(tr.result),
        });
      }
    }

    return { messages, turns, toolCallsMade, usedStrictMode: useStrict };
  }
}
