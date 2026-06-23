import OpenAI from "openai";
import { Harness } from "./core.js";
import type { ToolDefinition } from "./types.js";

const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "required",
});

const tools: ToolDefinition[] = [
  {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["city"],
    },
    fn: async ({ city, unit }) => {
      // Fake implementation — swap for a real API call
      return {
        city,
        temperature: unit === "fahrenheit" ? 72 : 22,
        condition: "sunny",
      };
    },
  },
  {
    name: "calculate",
    description: "Evaluate a simple math expression",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Math expression to evaluate, e.g. '2 + 2'" },
      },
      required: ["expression"],
    },
    fn: async ({ expression }) => {
      // Safe eval for demo only — don't use in production
      const result = Function(`"use strict"; return (${expression})`)();
      return { expression, result };
    },
  },
];

const harness = new Harness({ client, model: process.env.MODEL ?? "gpt-4o-mini" });

const result = await harness.run({
  messages: [
    {
      role: "user",
      content: "What's the weather in San Francisco in celsius, and what is 42 * 7?",
    },
  ],
  tools,
  maxTurns: 5,
  maxRetries: 3,
});

console.log("\n=== Final conversation ===");
for (const msg of result.messages) {
  if (msg.role === "assistant" && "content" in msg && msg.content) {
    console.log(`\nAssistant: ${msg.content}`);
  }
}
console.log(`\nTurns: ${result.turns} | Tool calls: ${result.toolCallsMade}`);
