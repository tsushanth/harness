import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import type { ToolDefinition, Message } from "./types.js";
import type { FineTuneCollector } from "./finetune.js";
import { toOpenAITools } from "./tools.js";
import { validateArgs } from "./schema.js";

export async function repairToolCall(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools: ToolDefinition[],
  rawArguments: string,
  _parseErrorHint: string,
  maxRetries: number,
  schema?: Record<string, unknown>,
  toolName?: string,
  collector?: FineTuneCollector
): Promise<Record<string, unknown>> {
  // Phase 1: parse JSON
  const parsed = tryParse(rawArguments);

  // Phase 2: validate against schema if we have one and JSON parsed OK
  if (parsed !== null && schema) {
    const validation = validateArgs(parsed, schema);
    if (validation.valid) return validation.data;

    const errorMessage = `The tool call arguments were valid JSON but failed schema validation:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}\n\nPlease fix these issues and retry the tool call.`;
    return repairWithError(client, model, messages, tools, rawArguments, errorMessage, maxRetries, schema, toolName, collector);
  }

  // JSON parse failed
  if (parsed === null) {
    const errorMessage = `The tool call had malformed JSON arguments that could not be parsed.\n\nRaw output was:\n${rawArguments}\n\nPlease retry the tool call with valid JSON arguments.`;
    return repairWithError(client, model, messages, tools, rawArguments, errorMessage, maxRetries, schema, toolName, collector);
  }

  return parsed;
}

async function repairWithError(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools: ToolDefinition[],
  originalRawArgs: string,
  errorMessage: string,
  maxRetries: number,
  schema?: Record<string, unknown>,
  toolName?: string,
  collector?: FineTuneCollector
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const repairMessages: Message[] = [
      ...messages,
      { role: "user", content: errorMessage },
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
    if (repaired === null) continue;

    if (schema) {
      const validation = validateArgs(repaired, schema);
      if (!validation.valid) {
        errorMessage = `Still failing schema validation:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}\n\nPlease fix these issues.`;
        continue;
      }
      // Record successful repair as training data
      if (collector && toolName) {
        collector.record(messages, toolName, originalRawArgs, errorMessage, validation.data);
      }
      return validation.data;
    }

    if (collector && toolName) {
      collector.record(messages, toolName, originalRawArgs, errorMessage, repaired);
    }
    return repaired;
  }

  throw new Error(
    `Failed to produce valid tool call arguments after ${maxRetries} repair attempts.\nLast error: ${errorMessage}`
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
