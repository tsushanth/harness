#!/usr/bin/env npx tsx
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";
import { Harness, formatCost } from "../src/index.js";
import type { ToolDefinition } from "../src/index.js";

// ── Provider setup ────────────────────────────────────────────────────────────
// Reads OPENROUTER_API_KEY or GROQ_API_KEY from env.
// Set whichever you have; OpenRouter is recommended (more model choice).
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

if (!OPENROUTER_KEY && !GROQ_KEY) {
  process.stderr.write(
    "Error: set OPENROUTER_API_KEY or GROQ_API_KEY in the MCP server env\n"
  );
  process.exit(1);
}

const client = OPENROUTER_KEY
  ? new OpenAI({
      apiKey: OPENROUTER_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    })
  : new OpenAI({
      apiKey: GROQ_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });

const DEFAULT_MODEL = OPENROUTER_KEY
  ? "meta-llama/llama-3.3-70b-instruct"
  : "llama-3.3-70b-versatile";

const harness = new Harness({ client, model: DEFAULT_MODEL });

// ── Built-in tools the open model can use ────────────────────────────────────
const DEMO_TOOLS: ToolDefinition[] = [
  {
    name: "calculate",
    description: "Evaluate a mathematical expression and return the result.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "A JavaScript-safe math expression, e.g. '2 ** 10 + 3 * 7'",
        },
      },
      required: ["expression"],
    },
    fn: ({ expression }) => {
      try {
        // Safe-ish: no network, no fs — just arithmetic
        const result = Function(`"use strict"; return (${expression as string})`)();
        return { result };
      } catch (e) {
        return { error: String(e) };
      }
    },
  },
  {
    name: "get_current_time",
    description: "Return the current UTC date and time.",
    parameters: { type: "object", properties: {} },
    fn: () => ({ utc: new Date().toISOString() }),
  },
  {
    name: "word_count",
    description: "Count words and characters in a block of text.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to analyse." },
      },
      required: ["text"],
    },
    fn: ({ text }) => {
      const t = text as string;
      return {
        words: t.split(/\s+/).filter(Boolean).length,
        characters: t.length,
        lines: t.split("\n").length,
      };
    },
  },
];

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "harness", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run_agent",
      description:
        "Run a prompt through an open-source LLM using the tool-use harness. " +
        "Use this to delegate cheap/repetitive subtasks to a faster or cheaper model. " +
        "The agent has access to: calculate, get_current_time, word_count.",
      inputSchema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description: "The user message / task to send to the open model.",
          },
          model: {
            type: "string",
            description:
              "Optional model override. Defaults to llama-3.3-70b-instruct (OpenRouter) " +
              "or llama-3.3-70b-versatile (Groq).",
          },
          system_prompt: {
            type: "string",
            description: "Optional extra system context to prepend.",
          },
        },
        required: ["prompt"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "run_agent") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { prompt, model, system_prompt } = request.params.arguments as {
    prompt: string;
    model?: string;
    system_prompt?: string;
  };

  const result = await harness.run({
    model: model ?? DEFAULT_MODEL,
    tools: DEMO_TOOLS,
    systemPrompt: system_prompt,
    messages: [{ role: "user", content: prompt }],
  });

  const lastMessage = [...result.messages]
    .reverse()
    .find((m) => m.role === "assistant");

  const answer =
    lastMessage && "content" in lastMessage && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "(no text response)";

  const costLine = result.cost ? `\n\n---\n_Cost: ${formatCost(result.cost)} · ${result.turns} turn(s) · ${result.toolCallsMade} tool call(s) · model: ${model ?? DEFAULT_MODEL}_` : "";

  return {
    content: [
      {
        type: "text",
        text: answer + costLine,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
