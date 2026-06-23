import type { EvalCase } from "./types.js";
import type { ToolDefinition } from "../types.js";

// Shared mock tools used across cases
const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get current weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" },
      unit: { type: "string", enum: ["celsius", "fahrenheit"] },
    },
    required: ["city"],
  },
  fn: async ({ city }) => ({ city, temperature: 22, condition: "sunny" }),
};

const calcTool: ToolDefinition = {
  name: "calculate",
  description: "Evaluate a math expression",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string" },
    },
    required: ["expression"],
  },
  fn: async ({ expression }) => ({
    result: Function(`"use strict"; return (${expression})`)(),
  }),
};

const searchTool: ToolDefinition = {
  name: "search",
  description: "Search the web for a query and return results",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
  fn: async ({ query }) => {
    // Return realistic-looking results so downstream tool calls have usable data
    const q = String(query).toLowerCase();
    if (q.includes("japan") && q.includes("population")) {
      return { results: ["Japan's population is approximately 125,000,000 as of 2024."] };
    }
    return { results: [`Search result for "${query}": no specific data found.`] };
  },
};

const errorTool: ToolDefinition = {
  name: "flaky_tool",
  description: "A tool that always returns an error",
  parameters: {
    type: "object",
    properties: { input: { type: "string" } },
    required: ["input"],
  },
  fn: async () => {
    throw new Error("Service unavailable");
  },
};

export const BASELINE_SUITE: EvalCase[] = [
  {
    id: "basic-tool-call",
    description: "Model calls the correct tool for a simple request",
    userMessage: "What is the weather in Tokyo?",
    tools: [weatherTool, calcTool],
    expect: {
      toolsCalled: ["get_weather"],
      args: { get_weather: { city: "Tokyo" } },
    },
  },
  {
    id: "correct-args-unit",
    description: "Model passes the correct unit argument when specified",
    userMessage: "What is the weather in London in fahrenheit?",
    tools: [weatherTool],
    expect: {
      toolsCalled: ["get_weather"],
      args: { get_weather: { city: "London", unit: "fahrenheit" } },
    },
  },
  {
    id: "parallel-tool-calls",
    description: "Model calls multiple tools in one turn when asked for two things",
    userMessage: "What is the weather in Paris, and what is 15 * 8?",
    tools: [weatherTool, calcTool],
    expect: {
      toolsCalled: ["get_weather", "calculate"],
    },
  },
  {
    id: "no-hallucinated-args",
    description: "Model does not invent argument values not mentioned by the user",
    userMessage: "Get the weather for San Francisco",
    tools: [weatherTool],
    expect: {
      toolsCalled: ["get_weather"],
      args: { get_weather: { city: "San Francisco" } },
      answerJudge: "The response mentions San Francisco weather and does not contradict the tool result (22°C, sunny).",
    },
  },
  {
    id: "answer-uses-tool-result",
    description: "Model incorporates tool result into final answer, not training data",
    userMessage: "What is 144 / 12?",
    tools: [calcTool],
    expect: {
      toolsCalled: ["calculate"],
      answerJudge: "The response correctly states the answer is 12, derived from the tool result.",
    },
  },
  {
    id: "tool-error-recovery",
    description: "Model reports tool error gracefully rather than hallucinating",
    userMessage: "Run flaky_tool with input 'hello'",
    tools: [errorTool],
    expect: {
      toolsCalled: ["flaky_tool"],
      answerJudge: "The response acknowledges that the tool failed or returned an error. It does not fabricate a successful result.",
    },
  },
  {
    id: "no-unnecessary-tools",
    description: "Model answers a factual question without calling tools when none are relevant",
    userMessage: "What is the capital of France?",
    tools: [weatherTool, searchTool],
    expect: {
      answerJudge: "The response correctly says Paris is the capital of France. It does not need to call any tools to answer this.",
    },
  },
  {
    id: "multi-step-chain",
    description: "Model chains two tool calls: search then calculate based on results",
    userMessage: "Search for the population of Japan and then calculate that number divided by 1000000",
    tools: [searchTool, calcTool],
    expect: {
      toolsCalled: ["search", "calculate"],
    },
  },
];
