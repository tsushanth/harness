import type { ToolDefinition } from "./types.js";

// Providers/models known to support strict structured output on tool calls.
// When strict=true, the model is constrained at decode time — repair loop is unnecessary.
const STRICT_SUPPORTED_PATTERNS = [
  /^gpt-4o/,
  /^gpt-4\.1/,
  /^gpt-3\.5-turbo/,
  /^o1/,
  /^o3/,
  /^o4/,
];

export function supportsStrictTools(model: string): boolean {
  return STRICT_SUPPORTED_PATTERNS.some((p) => p.test(model));
}

// Wraps tool definitions with strict=true and additionalProperties=false,
// which is required by the OpenAI structured output spec.
export function toStrictTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: enforceStrict(t.parameters),
      strict: true,
    },
  }));
}

// Recursively sets additionalProperties: false on all object schemas,
// which is required for strict mode to accept the schema.
function enforceStrict(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema["type"] !== "object") return schema;

  const properties = schema["properties"] as
    | Record<string, Record<string, unknown>>
    | undefined;

  return {
    ...schema,
    additionalProperties: false,
    properties: properties
      ? Object.fromEntries(
          Object.entries(properties).map(([k, v]) => [k, enforceStrict(v)])
        )
      : properties,
  };
}
