import type { Message } from "./types.js";

// Model context window limits (in tokens). Conservative — leaves headroom for the response.
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
  "llama-3.3-70b": 131_072,
  "llama-3.1-70b": 131_072,
  "llama-3.1-8b": 131_072,
  "mixtral-8x7b": 32_768,
  "qwen2.5-72b": 131_072,
  "gemma-2-27b": 8_192,
};

// Default for unknown models
const DEFAULT_CONTEXT_LIMIT = 32_768;

// Target: keep messages under this fraction of the limit to leave room for the response
const TARGET_FILL = 0.80;

export function getContextLimit(model: string): number {
  for (const [prefix, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (model.includes(prefix)) return limit;
  }
  return DEFAULT_CONTEXT_LIMIT;
}

// Rough token estimate: 1 token ≈ 4 chars for English/code.
// Accurate enough for pruning decisions without pulling in tiktoken.
export function estimateTokens(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

// Prune message history to fit within the context limit.
// Strategy (preserves coherence):
//   1. Always keep: system message + last user message
//   2. Remove oldest tool result messages first (bulk, low signal)
//   3. Remove oldest assistant messages next
//   4. If still over, remove oldest user messages (rare)
export function pruneMessages(messages: Message[], model: string): Message[] {
  const limit = Math.floor(getContextLimit(model) * TARGET_FILL);
  if (estimateTokens(messages) <= limit) return messages;

  const pruned = [...messages];

  // Identify index of last user message so we never remove it
  const lastUserIdx = [...pruned].reduce(
    (last, m, i) => (m.role === "user" ? i : last),
    -1
  );

  const tryRemove = (predicate: (m: Message, i: number) => boolean) => {
    for (let i = 1; i < pruned.length; i++) {
      if (i === lastUserIdx) continue;
      if (predicate(pruned[i]!, i)) {
        pruned.splice(i, 1);
        if (estimateTokens(pruned) <= limit) return true;
        i--; // recheck same index after removal
      }
    }
    return false;
  };

  // Pass 1: remove tool result messages (oldest first)
  tryRemove((m) => m.role === "tool");
  if (estimateTokens(pruned) <= limit) return pruned;

  // Pass 2: remove assistant messages (oldest first)
  tryRemove((m) => m.role === "assistant");
  if (estimateTokens(pruned) <= limit) return pruned;

  // Pass 3: remove user messages except the last (oldest first)
  tryRemove((m, i) => m.role === "user" && i !== lastUserIdx);

  return pruned;
}
