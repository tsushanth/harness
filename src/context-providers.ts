/**
 * Context providers — inject relevant codebase context before the model sees the task.
 *
 * Like Continue.dev's context providers: before dispatching to the model,
 * gather relevant context (open file, git diff, related files) and prepend
 * it to the user message. The model reasons over real context instead of
 * a bare prompt.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { extname, resolve, dirname } from "node:path";
import type { Message } from "./types.js";

export interface ContextProvider {
  name: string;
  fetch(): Promise<string | null>;
}

// ── Built-in providers ────────────────────────────────────────────────────────

/** Inject the full contents of a file */
export function fileProvider(filePath: string): ContextProvider {
  return {
    name: `file:${filePath}`,
    async fetch() {
      const abs = resolve(filePath);
      if (!existsSync(abs)) return null;
      const stat = statSync(abs);
      if (stat.size > 200_000) {
        return `[File ${filePath} is ${Math.round(stat.size / 1024)}KB — too large to include in full]`;
      }
      const content = readFileSync(abs, "utf8");
      return `### ${filePath}\n\`\`\`${extname(filePath).slice(1)}\n${content}\n\`\`\``;
    },
  };
}

/** Inject the current git diff (staged + unstaged) */
export function gitDiffProvider(cwd = "."): ContextProvider {
  return {
    name: "git:diff",
    async fetch() {
      try {
        const staged = execSync("git diff --cached", { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
        const unstaged = execSync("git diff", { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
        const combined = (staged + unstaged).trim();
        if (!combined) return null;
        // Truncate very large diffs
        const truncated = combined.length > 8_000
          ? combined.slice(0, 8_000) + "\n... [diff truncated]"
          : combined;
        return `### Git diff\n\`\`\`diff\n${truncated}\n\`\`\``;
      } catch {
        return null;
      }
    },
  };
}

/** Inject recent git log */
export function gitLogProvider(n = 5, cwd = "."): ContextProvider {
  return {
    name: "git:log",
    async fetch() {
      try {
        const log = execSync(`git log --oneline -${n}`, {
          cwd,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return log.trim() ? `### Recent commits\n\`\`\`\n${log.trim()}\n\`\`\`` : null;
      } catch {
        return null;
      }
    },
  };
}

/** Inject a directory tree (shallow) */
export function directoryProvider(dirPath = ".", depth = 2): ContextProvider {
  return {
    name: `directory:${dirPath}`,
    async fetch() {
      try {
        const tree = execSync(`find ${dirPath} -maxdepth ${depth} -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*"`, {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return tree.trim() ? `### Directory structure\n\`\`\`\n${tree.trim()}\n\`\`\`` : null;
      } catch {
        return null;
      }
    },
  };
}

/** Inject the contents of multiple related files */
export function filesProvider(filePaths: string[]): ContextProvider {
  return {
    name: `files:${filePaths.join(",")}`,
    async fetch() {
      const sections: string[] = [];
      for (const fp of filePaths) {
        const result = await fileProvider(fp).fetch();
        if (result) sections.push(result);
      }
      return sections.length > 0 ? sections.join("\n\n") : null;
    },
  };
}

/** Inject output of a shell command (e.g. test results, lint output) */
export function shellProvider(command: string, cwd = "."): ContextProvider {
  return {
    name: `shell:${command}`,
    async fetch() {
      try {
        const output = execSync(command, {
          cwd,
          encoding: "utf8",
          timeout: 15_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return output.trim()
          ? `### \`${command}\`\n\`\`\`\n${output.trim().slice(0, 4_000)}\n\`\`\``
          : null;
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        const out = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
        return out
          ? `### \`${command}\` (failed)\n\`\`\`\n${out.slice(0, 4_000)}\n\`\`\``
          : null;
      }
    },
  };
}

// ── Context injection ─────────────────────────────────────────────────────────

/**
 * Fetch all providers and prepend their output to the last user message.
 * Returns a new messages array — does not mutate the original.
 */
export async function injectContext(
  messages: Message[],
  providers: ContextProvider[]
): Promise<Message[]> {
  if (providers.length === 0) return messages;

  const sections = await Promise.all(providers.map((p) => p.fetch()));
  const contextBlock = sections.filter(Boolean).join("\n\n");
  if (!contextBlock) return messages;

  const result = [...messages];
  const lastUserIdx = [...result].reduce(
    (last, m, i) => (m.role === "user" ? i : last),
    -1
  );

  if (lastUserIdx === -1) return result;

  const lastUser = result[lastUserIdx]!;
  const originalContent =
    "content" in lastUser && typeof lastUser.content === "string"
      ? lastUser.content
      : "";

  result[lastUserIdx] = {
    ...lastUser,
    content: `<context>\n${contextBlock}\n</context>\n\n${originalContent}`,
  };

  return result;
}
