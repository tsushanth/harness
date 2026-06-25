/**
 * Diff-based file editing — like Continue.dev.
 *
 * Instead of overwriting entire files, the model produces a unified diff
 * and we apply it. This means:
 *   - Large files don't need to be re-sent in full
 *   - The model only reasons about the changed section
 *   - Partial edits are safe; unchanged lines are preserved exactly
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface DiffResult {
  path: string;
  linesAdded: number;
  linesRemoved: number;
  success: boolean;
  error?: string;
}

/**
 * Apply a unified diff string to a file on disk.
 * Supports standard unified diff format (--- / +++ / @@ headers).
 */
export function applyDiff(filePath: string, diffText: string): DiffResult {
  const base: DiffResult = { path: filePath, linesAdded: 0, linesRemoved: 0, success: false };

  if (!existsSync(filePath)) {
    return { ...base, error: `File not found: ${filePath}` };
  }

  const original = readFileSync(filePath, "utf8").split("\n");
  const lines = diffText.split("\n");

  // Parse hunks from unified diff
  const hunks: Array<{ startLine: number; original: string[]; replacement: string[] }> = [];
  let i = 0;

  // Skip file header lines (--- / +++)
  while (i < lines.length && (lines[i]!.startsWith("---") || lines[i]!.startsWith("+++"))) {
    i++;
  }

  while (i < lines.length) {
    const hunkHeader = lines[i]!;
    if (!hunkHeader.startsWith("@@")) { i++; continue; }

    // Parse @@ -startLine,count +startLine,count @@
    const match = hunkHeader.match(/@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (!match) { i++; continue; }

    const startLine = parseInt(match[1]!) - 1; // convert to 0-indexed
    i++;

    const origLines: string[] = [];
    const newLines: string[] = [];

    while (i < lines.length && !lines[i]!.startsWith("@@")) {
      const line = lines[i]!;
      if (line.startsWith("-")) {
        origLines.push(line.slice(1));
        base.linesRemoved++;
      } else if (line.startsWith("+")) {
        newLines.push(line.slice(1));
        base.linesAdded++;
      } else {
        // Context line — present in both
        const ctx = line.startsWith(" ") ? line.slice(1) : line;
        origLines.push(ctx);
        newLines.push(ctx);
      }
      i++;
    }

    hunks.push({ startLine, original: origLines, replacement: newLines });
  }

  if (hunks.length === 0) {
    return { ...base, error: "No hunks found in diff" };
  }

  // Apply hunks in reverse order so line numbers stay valid
  const result = [...original];
  for (const hunk of [...hunks].reverse()) {
    const { startLine, original: orig, replacement } = hunk;

    // Verify the original lines match (loose check — ignore trailing whitespace)
    const actualSlice = result.slice(startLine, startLine + orig.length);
    const matches = orig.every(
      (line, idx) => (actualSlice[idx] ?? "").trimEnd() === line.trimEnd()
    );

    if (!matches) {
      return {
        ...base,
        error: `Hunk at line ${startLine + 1} doesn't match file content. Re-read the file and regenerate the diff.`,
      };
    }

    result.splice(startLine, orig.length, ...replacement);
  }

  writeFileSync(filePath, result.join("\n"), "utf8");
  return { ...base, success: true };
}

/**
 * Generate a minimal unified diff between two strings (for display / testing).
 * Not used in the apply path — models generate diffs directly.
 */
export function makeDiff(original: string, modified: string, filePath = "file"): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");

  // Simple LCS-based diff — good enough for display
  const patch = unifiedDiff(origLines, modLines, filePath);
  return patch;
}

function unifiedDiff(a: string[], b: string[], label: string): string {
  // Myers diff algorithm (simplified)
  const edits = myersDiff(a, b);
  if (edits.length === 0) return "";

  const lines: string[] = [`--- ${label}`, `+++ ${label}`];
  let aIdx = 0, bIdx = 0;
  let i = 0;

  while (i < edits.length) {
    const hunkStart = i;
    const aStart = aIdx;
    const bStart = bIdx;
    const hunkLines: string[] = [];

    while (i < edits.length) {
      const [type, line] = edits[i]!;
      if (type === "=") { aIdx++; bIdx++; hunkLines.push(` ${line}`); }
      else if (type === "-") { aIdx++; hunkLines.push(`-${line}`); }
      else { bIdx++; hunkLines.push(`+${line}`); }
      i++;
      // End hunk after 3 consecutive context lines following a change
      if (type === "=" && i < edits.length && edits[i]![0] === "=") {
        const lookahead = edits.slice(i, i + 3).every(([t]) => t === "=");
        if (lookahead) break;
      }
    }

    const removals = hunkLines.filter((l) => l.startsWith("-")).length;
    const additions = hunkLines.filter((l) => l.startsWith("+")).length;
    lines.push(`@@ -${aStart + 1},${removals + hunkLines.filter(l => l.startsWith(" ")).length} +${bStart + 1},${additions + hunkLines.filter(l => l.startsWith(" ")).length} @@`);
    lines.push(...hunkLines);
  }

  return lines.join("\n");
}

type Edit = ["=" | "-" | "+", string];

function myersDiff(a: string[], b: string[]): Edit[] {
  const n = a.length, m = b.length;
  const max = n + m;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + max]! < v[k + 1 + max]!)
          ? v[k + 1 + max]!
          : v[k - 1 + max]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[k + max] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, a, b, max);
      }
    }
  }
  return backtrack(trace, a, b, max);
}

function backtrack(trace: number[][], a: string[], b: string[], max: number): Edit[] {
  const edits: Edit[] = [];
  let x = a.length, y = b.length;

  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const v = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[k - 1 + max]! < v[k + 1 + max]!)
        ? k + 1
        : k - 1;
    const prevX = v[prevK + max]!;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) { edits.unshift(["=", a[--x]!]); y--; }
    if (d > 0) {
      if (x > prevX) edits.unshift(["-", a[--x]!]);
      else if (y > prevY) edits.unshift(["+", b[--y]!]);
    }
  }
  return edits;
}
