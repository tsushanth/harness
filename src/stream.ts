import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import type { RunOptions, Message, ToolCall } from "./types.js";
import { toOpenAITools, dispatch } from "./tools.js";
import { repairToolCall } from "./repair.js";
import { buildSystemPrompt, detectModelFamily } from "./prompt.js";
import { supportsStrictTools, toStrictTools } from "./structured.js";

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; name: string; id: string }
  | { type: "tool_end"; name: string; id: string; result: unknown; error?: string }
  | { type: "done"; turns: number; toolCallsMade: number; usedStrictMode: boolean };

export async function* streamRun(
  client: OpenAI,
  options: RunOptions & { model: string }
): AsyncGenerator<StreamEvent> {
  const { tools, maxTurns = 10, maxRetries = 3, model, maxTokens } = options;

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
    const stream = await client.chat.completions.create({
      model,
      messages,
      tools: openAITools,
      tool_choice: "auto",
      stream: true,
      ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    });

    // Accumulate the streamed response
    let textContent = "";
    const toolCallAccumulators: Record<
      number,
      { id: string; name: string; arguments: string }
    > = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Stream text tokens to the caller
      if (delta.content) {
        textContent += delta.content;
        yield { type: "text", delta: delta.content };
      }

      // Accumulate tool call chunks (they arrive in pieces)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccumulators[idx]) {
            toolCallAccumulators[idx] = { id: tc.id ?? "", name: "", arguments: "" };
          }
          const acc = toolCallAccumulators[idx]!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    turns++;

    const rawToolCalls = Object.values(toolCallAccumulators).filter(
      (tc) => tc.name
    ) as { id: string; name: string; arguments: string }[];

    // Push assistant message into history
    const asFnCalls: ChatCompletionMessageFunctionToolCall[] = rawToolCalls.map(
      (tc) => ({ type: "function" as const, id: tc.id, function: { name: tc.name, arguments: tc.arguments } })
    );
    messages.push({
      role: "assistant",
      content: textContent || null,
      ...(asFnCalls.length > 0 ? { tool_calls: asFnCalls } : {}),
    });

    if (rawToolCalls.length === 0) break;

    // Dispatch tool calls — must be sequential in the generator to allow yield
    const toolResults: Awaited<ReturnType<typeof dispatch>>[] = [];

    for (const tc of rawToolCalls) {
      yield { type: "tool_start" as const, name: tc.name, id: tc.id };

      const toolDef = tools.find((t) => t.name === tc.name);
      let args: Record<string, unknown>;

      try {
        args = useStrict
          ? (JSON.parse(tc.arguments) as Record<string, unknown>)
          : await repairToolCall(
              client, model, messages, tools,
              tc.arguments, "initial parse", maxRetries,
              toolDef?.parameters
            );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        yield { type: "tool_end" as const, name: tc.name, id: tc.id, result: null, error };
        toolResults.push({ id: tc.id, name: tc.name, result: null, error });
        continue;
      }

      const call: ToolCall = { id: tc.id, name: tc.name, arguments: args };
      toolCallsMade++;
      const result = await dispatch(call, tools);
      const ev: StreamEvent = result.error
        ? { type: "tool_end", name: result.name, id: result.id, result: result.result, error: result.error }
        : { type: "tool_end", name: result.name, id: result.id, result: result.result };
      yield ev;
      toolResults.push(result);
    }

    for (const tr of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: tr.id,
        content: tr.error ? `Error: ${tr.error}` : JSON.stringify(tr.result),
      });
    }
  }

  yield { type: "done", turns, toolCallsMade, usedStrictMode: useStrict };
}
