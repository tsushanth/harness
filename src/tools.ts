import type { ToolDefinition, ToolCall, ToolResult } from "./types.js";

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
