/**
 * Plan-then-execute: decompose a task into ordered steps before dispatching tools.
 *
 * Instead of hoping the model will batch parallel calls (Llama scores 34%),
 * we ask it to produce an explicit numbered plan first, then execute each step
 * sequentially. Llama scores 90% on "pick the right tool" (multiple category),
 * so sequential execution of a good plan beats unreliable parallel batching.
 */
import OpenAI from "openai";
import type { Message, ToolDefinition } from "./types.js";
import { toOpenAITools } from "./tools.js";
import { withRetry } from "./retry.js";

export interface Plan {
  steps: PlanStep[];
  reasoning: string;
}

export interface PlanStep {
  index: number;
  description: string;   // human-readable
  tool: string;          // tool name to call
  dependsOn: number[];   // step indices this step must wait for (empty = can run first)
}

const PLANNER_SYSTEM = `You are a task planner. Given a user request and a list of available tools, produce a step-by-step execution plan.

Rules:
- Each step must use exactly one tool
- Steps that depend on a previous step's output must list that step in dependsOn
- Steps with no dependencies can run in parallel (but list them as sequential if unsure)
- Be conservative: prefer sequential over parallel when in doubt
- Only include steps that are strictly necessary

Respond with valid JSON matching this schema exactly:
{
  "reasoning": "brief explanation of the plan",
  "steps": [
    {
      "index": 0,
      "description": "what this step does",
      "tool": "tool_name",
      "dependsOn": []
    }
  ]
}`;

export async function makePlan(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools: ToolDefinition[],
  signal?: AbortSignal
): Promise<Plan | null> {
  // Only plan if there are multiple tools and a clear multi-step task
  if (tools.length < 2) return null;

  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUserMessage || !("content" in lastUserMessage)) return null;
  const userContent =
    typeof lastUserMessage.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage.content);

  const planMessages: Message[] = [
    { role: "system", content: PLANNER_SYSTEM },
    {
      role: "user",
      content: `Available tools:\n${toolList}\n\nUser request: ${userContent}\n\nProduce the execution plan as JSON.`,
    },
  ];

  try {
    const response = await withRetry(
      () =>
        client.chat.completions.create({
          model,
          messages: planMessages,
          temperature: 0,
          max_tokens: 1024,
          ...(signal != null ? { signal } : {}),
        }),
      signal != null ? { signal } : {}
    );

    const text = response.choices[0]?.message.content ?? "";
    // Extract JSON from the response (model may wrap it in ```json blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const plan = JSON.parse(jsonMatch[0]) as Plan;
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) return null;

    // Validate all referenced tools exist
    const toolNames = new Set(tools.map((t) => t.name));
    const validSteps = plan.steps.filter((s) => toolNames.has(s.tool));
    if (validSteps.length === 0) return null;

    return { ...plan, steps: validSteps };
  } catch {
    // Planning failed — fall through to normal execution
    return null;
  }
}

// Inject the plan into the system prompt so the model follows it
export function planToSystemAddendum(plan: Plan): string {
  const stepLines = plan.steps
    .map(
      (s) =>
        `  Step ${s.index + 1}: ${s.description} → use ${s.tool}` +
        (s.dependsOn.length > 0
          ? ` (after step ${s.dependsOn.map((d) => d + 1).join(", ")})`
          : "")
    )
    .join("\n");

  return `\n\nEXECUTION PLAN (follow this order exactly):\n${stepLines}\n\nExecute each step in order. Do not skip steps or change the sequence.`;
}

// Convert plan steps into tool-call messages the harness loop can execute
export function planUsesTools(plan: Plan, tools: ToolDefinition[]): string[] {
  const toolNames = new Set(tools.map((t) => t.name));
  return plan.steps.map((s) => s.tool).filter((t) => toolNames.has(t));
}
