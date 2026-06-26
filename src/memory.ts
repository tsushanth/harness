/**
 * SessionMemory — persistent across-session learning.
 *
 * Captures corrections, preferences, and successful tool patterns during a run.
 * On next session start, injects them as context so the model doesn't re-learn
 * what already works in this environment.
 *
 * The FineTuneCollector exports JSONL for model training.
 * This is different — it's runtime injection into the next conversation.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ContextProvider } from "./context-providers.js";
import type { RunResult } from "./types.js";

export type MemoryEntryType = "correction" | "preference" | "example" | "observation";

export interface MemoryEntry {
  type: MemoryEntryType;
  content: string;
  timestamp: string;
  tags?: string[];
}

export interface MemoryStore {
  version: 1;
  entries: MemoryEntry[];
}

const DEFAULT_PATH = ".harness-memory.json";

// ── Persistence ───────────────────────────────────────────────────────────────

function load(path: string): MemoryStore {
  if (!existsSync(path)) return { version: 1, entries: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MemoryStore;
  } catch {
    return { version: 1, entries: [] };
  }
}

function save(path: string, store: MemoryStore): void {
  writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
}

// ── SessionMemory class ───────────────────────────────────────────────────────

export class SessionMemory {
  private store: MemoryStore;
  private path: string;

  constructor(path = DEFAULT_PATH) {
    this.path = path;
    this.store = load(path);
  }

  /** Explicitly record a fact, correction, or preference. */
  remember(content: string, type: MemoryEntryType = "observation", tags?: string[]): void {
    const entry: MemoryEntry = {
      type,
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };
    if (tags) entry.tags = tags;
    this.store.entries.push(entry);
    save(this.path, this.store);
  }

  /**
   * Scan a completed run result and auto-extract learnable patterns:
   * - Which tools succeeded (and with what shape of args)
   * - Whether pruning fired (context pressure signal)
   *
   * Call this after harness.run() to accumulate patterns across sessions.
   */
  learnFromRun(result: RunResult, taskDescription?: string): void {
    if (result.toolCallsMade === 0) return;

    // Record tool sequences that completed successfully (no wasPruned blow-up)
    const toolCalls: Array<{ name: string; args: unknown }> = [];
    for (const msg of result.messages) {
      if (
        msg.role === "assistant" &&
        "tool_calls" in msg &&
        Array.isArray(msg.tool_calls)
      ) {
        for (const tc of msg.tool_calls as Array<{ function?: { name?: string; arguments?: string } }>) {
          if (tc.function?.name) {
            try {
              toolCalls.push({
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments ?? "{}"),
              });
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    }

    if (toolCalls.length > 0 && taskDescription) {
      const summary = toolCalls.map((t) => t.name).join(" → ");
      this.remember(
        `For "${taskDescription}": used tool sequence [${summary}] successfully in ${result.turns} turn(s).`,
        "example",
        toolCalls.map((t) => t.name)
      );
    }

    if (result.wasPruned) {
      this.remember(
        "Context was pruned during a run — consider increasing maxToolResultChars or reducing maxTurns.",
        "observation"
      );
    }
  }

  /** Remove all entries (or entries matching a tag). */
  forget(tag?: string): void {
    if (tag) {
      this.store.entries = this.store.entries.filter(
        (e) => !e.tags?.includes(tag)
      );
    } else {
      this.store.entries = [];
    }
    save(this.path, this.store);
  }

  /** All stored entries. */
  entries(): MemoryEntry[] {
    return this.store.entries;
  }

  /**
   * Returns a ContextProvider that injects the memory as a <memory> block
   * before the first user message. Pass this in contextProviders on every run.
   */
  asContextProvider(): ContextProvider {
    const entries = this.store.entries;
    return {
      name: "session:memory",
      async fetch() {
        if (entries.length === 0) return null;

        const sections: Record<string, string[]> = {};
        for (const e of entries) {
          (sections[e.type] ??= []).push(`- ${e.content}`);
        }

        const parts: string[] = ["### Session memory (learned from prior runs)"];
        const order: MemoryEntryType[] = ["correction", "preference", "example", "observation"];
        for (const type of order) {
          const lines = sections[type];
          if (lines && lines.length > 0) {
            parts.push(`\n**${type[0]!.toUpperCase() + type.slice(1)}s:**\n${lines.join("\n")}`);
          }
        }

        return parts.join("\n");
      },
    };
  }
}

// ── remember() tool definition ────────────────────────────────────────────────

/**
 * A tool the model can call to save its own observations.
 * Add this to your tools array so the model can self-update the memory store.
 *
 * Example: the model calls remember({ content: "use --draft flag for this repo", type: "preference" })
 * and that fact persists into the next session automatically.
 */
export function makeRememberTool(memory: SessionMemory) {
  return {
    name: "remember",
    description:
      "Save a fact, correction, or preference to persistent memory. " +
      "Use this when you discover something about the user's environment, workflow, or preferences " +
      "that you should remember in future sessions. " +
      "Examples: 'this repo requires signed commits', 'use --draft for new PRs', 'tests run with npm test not jest'.",
    parameters: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The fact to remember. Be specific and actionable.",
        },
        type: {
          type: "string",
          enum: ["correction", "preference", "example", "observation"],
          description:
            "correction = fix a wrong assumption; preference = user/repo style; " +
            "example = a successful pattern; observation = general finding.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for filtering later (e.g. tool names, repo name).",
        },
      },
      required: ["content"],
    },
    fn: (args: Record<string, unknown>) => {
      const content = args["content"] as string;
      const type = (args["type"] as MemoryEntryType | undefined) ?? "observation";
      const tags = args["tags"] as string[] | undefined;
      memory.remember(content, type, tags);
      return { saved: true, content };
    },
  };
}
