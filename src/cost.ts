import type { TokenUsage } from "./types.js";

export interface CostEstimate {
  inputCost: number;   // USD
  outputCost: number;  // USD
  totalCost: number;   // USD
}

// Pricing in USD per 1M tokens (input, output).
// Sources: provider pricing pages as of 2025-Q2.
const PRICING: Array<{ prefix: string; input: number; output: number }> = [
  // OpenAI
  { prefix: "gpt-4o",               input: 2.50,  output: 10.00 },
  { prefix: "gpt-4o-mini",          input: 0.15,  output: 0.60  },
  { prefix: "gpt-4-turbo",          input: 10.00, output: 30.00 },
  { prefix: "gpt-4",                input: 30.00, output: 60.00 },
  { prefix: "gpt-3.5-turbo",        input: 0.50,  output: 1.50  },
  // Anthropic
  { prefix: "claude-3-5-sonnet",    input: 3.00,  output: 15.00 },
  { prefix: "claude-3-5-haiku",     input: 0.80,  output: 4.00  },
  { prefix: "claude-3-opus",        input: 15.00, output: 75.00 },
  { prefix: "claude-3-sonnet",      input: 3.00,  output: 15.00 },
  { prefix: "claude-3-haiku",       input: 0.25,  output: 1.25  },
  // Meta Llama (via OpenRouter / Together / Groq — representative)
  { prefix: "llama-3.3-70b",        input: 0.59,  output: 0.79  },
  { prefix: "llama-3.1-70b",        input: 0.59,  output: 0.79  },
  { prefix: "llama-3.1-8b",         input: 0.06,  output: 0.06  },
  // Mistral
  { prefix: "mixtral-8x7b",         input: 0.60,  output: 0.60  },
  { prefix: "mistral-large",        input: 3.00,  output: 9.00  },
  { prefix: "mistral-small",        input: 0.20,  output: 0.60  },
  // Qwen
  { prefix: "qwen2.5-72b",          input: 0.40,  output: 0.40  },
  // Google Gemma (via OpenRouter)
  { prefix: "gemma-2-27b",          input: 0.27,  output: 0.27  },
  { prefix: "gemma-2-9b",           input: 0.06,  output: 0.06  },
];

function getPricing(model: string): { input: number; output: number } | null {
  const lower = model.toLowerCase();
  for (const entry of PRICING) {
    if (lower.includes(entry.prefix)) return entry;
  }
  return null;
}

export function estimateCost(usage: TokenUsage, model: string): CostEstimate | null {
  const pricing = getPricing(model);
  if (!pricing) return null;

  const inputCost  = (usage.promptTokens     / 1_000_000) * pricing.input;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;
  return {
    inputCost:  Math.round(inputCost  * 1_000_000) / 1_000_000,
    outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    totalCost:  Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
  };
}

export function formatCost(estimate: CostEstimate): string {
  const fmt = (n: number) =>
    n < 0.001 ? `$${(n * 1000).toFixed(4)}m` : `$${n.toFixed(4)}`;
  return `${fmt(estimate.totalCost)} (in: ${fmt(estimate.inputCost)}, out: ${fmt(estimate.outputCost)})`;
}
