import type { ToolDefinition } from "./types.js";

export type ModelFamily = "llama" | "qwen" | "mistral" | "gemma" | "generic";

export function detectModelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (m.includes("llama")) return "llama";
  if (m.includes("qwen")) return "qwen";
  if (m.includes("mistral") || m.includes("mixtral")) return "mistral";
  if (m.includes("gemma")) return "gemma";
  return "generic";
}

const BASE_TOOL_USE_PROMPT = `\
You are a helpful assistant with access to tools. Follow these rules strictly:

## When to use tools
- Use a tool whenever the user asks for information or actions that a tool can provide.
- Do NOT answer from memory when a tool exists for the task — always prefer the tool result.
- Do NOT call a tool if you already have the answer from a previous tool result in this conversation.

## How to use tools
- Call only the tools that are necessary. Do not call extra tools "just in case."
- Only pass argument values that are explicitly stated or clearly implied by the user. Never invent or assume argument values.
- If a required argument is missing and you cannot reasonably infer it, ask the user before calling the tool.

## Parallel vs sequential tool calls
- **Call tools in parallel (same turn)** when their inputs are independent — neither tool needs the other's output to form its arguments. Example: getting weather in two cities, or getting weather AND calculating a number the user already provided.
- **Call tools sequentially (separate turns)** when one tool's output is needed as input to the next. Example: search for a value, then use that value as an argument to calculate. Wait for the first result before making the second call.
- When unsure, ask yourself: "Do I already know all the arguments for both tools?" If yes → parallel. If no → sequential.

## After tool results
- Always use the tool result to form your answer. Do not ignore or contradict tool results.
- If a tool returns an error, explain what went wrong and either retry with corrected arguments or ask the user for clarification.
- Once you have all the information you need from tools, stop calling tools and give a final answer.

## When to stop
- When you have enough tool results to fully answer the user's request, respond with your final answer. Do not make additional tool calls.
- If a tool call fails repeatedly, tell the user rather than looping indefinitely.`;

// Model-family-specific addenda that address known behavioral quirks
const FAMILY_ADDENDA: Record<ModelFamily, string> = {
  llama: `\

## Additional instructions
- You must always call a tool using the tool call interface provided. Do not write raw JSON, function signatures, or tool call syntax in your text responses.
- When the user asks for multiple independent things (e.g. weather in two cities, or weather AND a calculation using numbers already provided), call ALL required tools in a SINGLE response — do not split them across turns.
- After receiving tool results, write a natural language response to the user. Do not repeat or echo the tool call JSON in your final answer.
- For boolean parameters: pass the literal JSON values true or false (no quotes). Never pass "true" or "false" as strings.`,

  qwen: `\

## Additional instructions
- When multiple tools are needed, you may call them in parallel in a single response.
- Do not add markdown code blocks around tool calls.
- After all tool results are returned, give one final synthesized answer.`,

  mistral: `\

## Additional instructions
- Always use the structured tool call format. Do not describe what you would call — actually call it.
- Do not repeat tool calls that have already been made and returned results.`,

  gemma: `\

## Additional instructions
- Use tools for factual lookups. Do not substitute your training knowledge when a tool result is available.
- Keep tool arguments minimal — only include what is explicitly required by the tool schema.`,

  generic: `\

## Additional instructions
- When a tool's output is needed as an argument to another tool, always wait for the first result before calling the second. Do not guess or fabricate the intermediate value.`,
};

export function buildSystemPrompt(
  tools: ToolDefinition[],
  modelFamily: ModelFamily,
  existingSystemPrompt?: string
): string {
  const toolList = tools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join("\n");

  const toolSection = `\
## Available tools
${toolList}`;

  const base = `${BASE_TOOL_USE_PROMPT}\n\n${toolSection}${FAMILY_ADDENDA[modelFamily]}`;

  if (existingSystemPrompt) {
    return `${existingSystemPrompt}\n\n---\n\n${base}`;
  }

  return base;
}
