import OpenAI from "openai";
import { Harness } from "./core.js";
import type { ToolDefinition } from "./types.js";

const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL!,
  apiKey: process.env.OPENAI_API_KEY!,
});

const errorTool: ToolDefinition = {
  name: "flaky_tool",
  description: "A tool that always returns an error",
  parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
  fn: async () => { throw new Error("Service unavailable"); },
};

const searchTool: ToolDefinition = {
  name: "search",
  description: "Search the web for a query and return results",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  fn: async ({ query }) => ({ results: [`Result 1 for ${query}`, `Result 2 for ${query}`] }),
};

const calcTool: ToolDefinition = {
  name: "calculate",
  description: "Evaluate a math expression",
  parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  fn: async ({ expression }) => ({ result: Function(`"use strict"; return (${expression})`)() }),
};

const h1 = new Harness({ client, model: "meta-llama/llama-3.3-70b-instruct" });
const r1 = await h1.run({
  messages: [{ role: "user", content: "Run flaky_tool with input 'hello'" }],
  tools: [errorTool],
});
const a1 = [...r1.messages].reverse().find((m) => m.role === "assistant" && "content" in m && m.content);
console.log("\nLLAMA tool-error-recovery answer:");
console.log(a1 && "content" in a1 ? a1.content : "(no text response)");

const h2 = new Harness({ client, model: "openai/gpt-4o-mini" });
const r2 = await h2.run({
  messages: [{ role: "user", content: "Search for the population of Japan and then calculate that number divided by 1000000" }],
  tools: [searchTool, calcTool],
});
const a2 = [...r2.messages].reverse().find((m) => m.role === "assistant" && "content" in m && m.content);
console.log("\nGPT multi-step-chain answer:");
console.log(a2 && "content" in a2 ? a2.content : "(no text response)");
console.log("\nGPT tool messages:");
r2.messages.filter((m) => m.role === "tool").forEach((m) => {
  console.log(" tool_call_id:", "tool_call_id" in m ? m.tool_call_id : "?", "| content:", "content" in m ? String(m.content).slice(0, 100) : "");
});
