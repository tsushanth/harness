import type { ToolDefinition, ToolCall, ToolResult } from "./types.js";

// Default max chars for a serialized tool result injected into context.
// ~4k chars ≈ ~1k tokens — enough for most API responses, avoids blowing context.
const DEFAULT_RESULT_MAX_CHARS = 4_000;

export function serializeToolResult(
  result: unknown,
  maxChars = DEFAULT_RESULT_MAX_CHARS
): string {
  const serialized =
    result === null || result === undefined
      ? "null"
      : typeof result === "string"
      ? result
      : JSON.stringify(result);

  if (serialized.length <= maxChars) return serialized;

  const truncated = serialized.slice(0, maxChars);
  return `${truncated}\n... [truncated: ${serialized.length - maxChars} chars omitted]`;
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export async function dispatch(
  call: ToolCall,
  tools: ToolDefinition[]
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name);

  if (!tool) {
    return {
      id: call.id,
      name: call.name,
      result: null,
      error: `Unknown tool: "${call.name}". Available tools: ${tools.map((t) => t.name).join(", ")}`,
    };
  }

  try {
    const result = await tool.fn(call.arguments);
    return { id: call.id, name: call.name, result };
  } catch (err) {
    return {
      id: call.id,
      name: call.name,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
