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
  {
    id: "schema-enum-enforcement",
    description: "Harness validates enum and tool still produces a valid result",
    userMessage: "Get the weather in Berlin. Use celsius.",
    tools: [
      {
        name: "get_weather",
        description: "Get current weather for a city.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" },
            unit: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["city", "unit"],
        },
        fn: async ({ city, unit }) => ({ city, temperature: 22, unit, condition: "cloudy" }),
      },
    ],
    expect: {
      toolsCalled: ["get_weather"],
      args: { get_weather: { city: "Berlin", unit: "celsius" } },
      answerJudge: "The response gives Berlin weather in celsius.",
    },
  },
  {
    id: "schema-required-field",
    description: "Model passes all required fields when the schema makes them explicit",
    userMessage: "What is 99 * 99?",
    tools: [
      {
        name: "calculate",
        description: "Evaluate a math expression.",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "The math expression to evaluate, e.g. '2 + 2'" },
          },
          required: ["expression"],
        },
        fn: async ({ expression }) => ({
          result: Function(`"use strict"; return (${expression})`)(),
        }),
      },
    ],
    expect: {
      toolsCalled: ["calculate"],
      args: { calculate: { expression: "99 * 99" } },
      answerJudge: "The response correctly states the answer is 9801.",
    },
  },

  // ── Adversarial schema cases ────────────────────────────────────────────────
  // These probe the schema-aware repair loop. The tools have strict schemas;
  // a model that passes wrong types / missing fields will be repaired by the harness.

  {
    id: "adversarial-wrong-type",
    description: "Model refuses or asks for clarification when city is ambiguous — correct behavior",
    userMessage: "Get the weather for city number 42.",
    tools: [
      {
        name: "get_weather",
        description: "Get current weather. city must be a string city name like 'Tokyo'.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name as a string, e.g. 'Tokyo'" },
          },
          required: ["city"],
        },
        fn: async ({ city }) => ({ city, temperature: 18, condition: "rainy" }),
      },
    ],
    expect: {
      // Correct behavior: model asks for clarification rather than guessing or passing bad args
      answerJudge: "The response asks the user to clarify which city they mean, OR provides weather for a city it inferred. It does NOT crash or produce an error.",
    },
  },

  {
    id: "adversarial-nested-required",
    description: "Tool has nested required fields; model provides all of them correctly",
    userMessage: "Send an email to alice@example.com with subject 'Hello' and body 'Hi there'.",
    tools: [
      {
        name: "send_email",
        description: "Send an email message",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            message: {
              type: "object",
              description: "The email message",
              properties: {
                subject: { type: "string" },
                body: { type: "string" },
              },
              required: ["subject", "body"],
            },
          },
          required: ["to", "message"],
        },
        fn: async ({ to, message }) => {
          const msg = (message ?? {}) as Record<string, unknown>;
          return { sent: true, to, subject: msg["subject"] ?? null };
        },
      },
    ],
    expect: {
      toolsCalled: ["send_email"],
      answerJudge: "The response confirms the email was sent to alice@example.com.",
    },
  },

  {
    id: "adversarial-strict-string-expression",
    description: "Expression field must be a string — model should not pass a numeric value",
    userMessage: "Calculate 256 divided by 4.",
    tools: [
      {
        name: "calculate",
        description: "Evaluate a math expression. The expression MUST be a string like '256 / 4', not a number.",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "Math expression as a string, e.g. '256 / 4'",
            },
          },
          required: ["expression"],
        },
        fn: async ({ expression }) => ({
          result: Function(`"use strict"; return (${expression})`)(),
        }),
      },
    ],
    expect: {
      toolsCalled: ["calculate"],
      answerJudge: "The response correctly states the answer is 64.",
    },
  },

  {
    id: "adversarial-multi-tool-partial-failure",
    description: "Two tools called; one has a strict enum — both must end up with valid args",
    userMessage: "Get the weather in Rome in celsius and calculate 7 * 8.",
    tools: [
      {
        name: "get_weather",
        description: "Get weather. unit must be exactly 'celsius' or 'fahrenheit'.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" },
            unit: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["city", "unit"],
        },
        fn: async ({ city, unit }) => ({ city, temperature: 28, unit, condition: "sunny" }),
      },
      {
        name: "calculate",
        description: "Evaluate a math expression string.",
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
      },
    ],
    expect: {
      toolsCalled: ["get_weather", "calculate"],
      args: {
        get_weather: { city: "Rome", unit: "celsius" },
        calculate: { expression: "7 * 8" },
      },
      answerJudge: "The response gives Rome weather in celsius and states that 7 * 8 = 56.",
    },
  },

  {
    id: "adversarial-boolean-coercion",
    description: "Tool has a boolean required field; model passes it correctly as a boolean",
    userMessage: "Search for 'AI news' using the search tool. Enable safe search.",
    tools: [
      {
        name: "search",
        description: "Search the web. The safe parameter is required and must be a boolean (true/false).",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            safe: {
              type: "boolean",
              description: "Enable safe search. Pass true or false as a boolean value.",
            },
          },
          required: ["query", "safe"],
        },
        fn: async ({ query, safe }) => ({
          results: [`Search result for "${query}" (safe=${String(safe)})`],
        }),
      },
    ],
    expect: {
      toolsCalled: ["search"],
      answerJudge: "The response summarizes or acknowledges search results about AI news.",
    },
  },
];
