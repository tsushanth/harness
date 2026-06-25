import * as vscode from "vscode";
import * as path from "path";

interface Hunk {
  oldStart: number;
  oldLines: string[];
  newLines: string[];
}

function parseDiff(diffText: string): Map<string, Hunk[]> {
  const fileMap = new Map<string, Hunk[]>();
  let currentFile: string | null = null;
  let hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      if (currentFile && hunks.length > 0) fileMap.set(currentFile, hunks);
      currentFile = line.slice(4).replace(/^b\//, "").trim();
      hunks = [];
      currentHunk = null;
    } else if (line.startsWith("@@ ")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      if (m) {
        currentHunk = { oldStart: parseInt(m[1], 10), oldLines: [], newLines: [] };
        hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith("-")) {
        currentHunk.oldLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        currentHunk.newLines.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        currentHunk.oldLines.push(line.slice(1));
        currentHunk.newLines.push(line.slice(1));
      }
    }
  }
  if (currentFile && hunks.length > 0) fileMap.set(currentFile, hunks);
  return fileMap;
}

export async function applyDiffToEditor(
  diffText: string,
  workspaceRoot: string | undefined
): Promise<{ applied: number; errors: string[] }> {
  const fileMap = parseDiff(diffText);
  let applied = 0;
  const errors: string[] = [];

  for (const [filePath, hunks] of fileMap) {
    try {
      const absPath = workspaceRoot
        ? path.resolve(workspaceRoot, filePath)
        : path.resolve(filePath);

      const uri = vscode.Uri.file(absPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });

      const success = await editor.edit((editBuilder) => {
        // Apply hunks in reverse to preserve line numbers
        for (const hunk of [...hunks].reverse()) {
          const startLine = hunk.oldStart - 1; // 0-indexed
          const endLine = startLine + hunk.oldLines.length;

          const range = new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, 0)
          );

          const newText = hunk.newLines.map((l) => l + "\n").join("");
          editBuilder.replace(range, newText);
        }
      });

      if (success) {
        await doc.save();
        applied++;
      } else {
        errors.push(`Failed to apply diff to ${filePath}`);
      }
    } catch (err) {
      errors.push(`${filePath}: ${String(err)}`);
    }
  }

  return { applied, errors };
}

/** Extract all ```diff blocks from a model response and apply them */
export async function applyDiffsFromResponse(
  responseText: string,
  workspaceRoot: string | undefined
): Promise<{ applied: number; errors: string[] }> {
  const blocks = [...responseText.matchAll(/```diff\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  if (blocks.length === 0) {
    return { applied: 0, errors: ["No diff blocks found in response"] };
  }

  let applied = 0;
  const errors: string[] = [];

  for (const block of blocks) {
    const result = await applyDiffToEditor(block, workspaceRoot);
    applied += result.applied;
    errors.push(...result.errors);
  }

  return { applied, errors };
}
