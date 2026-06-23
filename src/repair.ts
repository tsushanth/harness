import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import type { ToolDefinition, Message } from "./types.js";
import { toOpenAITools } from "./tools.js";

export async function repairToolCall(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools: ToolDefinition[],
  rawArguments: string,
  parseError: string,
  maxRetries: number
): Promise<Record<string, unknown>> {
  const parsed = tryParse(rawArguments);
  if (parsed !== null) return parsed;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const repairMessages: Message[] = [
      ...messages,
      {
        role: "user",
        content: `Your last tool call had malformed JSON arguments: ${parseError}\n\nRaw output was:\n${rawArguments}\n\nPlease retry the tool call with valid JSON arguments.`,
      },
    ];

    const response = await client.chat.completions.create({
      model,
      messages: repairMessages,
      tools: toOpenAITools(tools),
      tool_choice: "required",
    });

    const choice = response.choices[0];
    if (!choice) continue;

    const toolCall = (choice.message.tool_calls ?? []).find(
      (tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function"
    );
    if (!toolCall) continue;

    const repaired = tryParse(toolCall.function.arguments);
    if (repaired !== null) return repaired;
  }

  throw new Error(
    `Failed to get valid tool call JSON after ${maxRetries} repair attempts. Last error: ${parseError}`
  );
}

function tryParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
