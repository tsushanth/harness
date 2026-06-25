import * as vscode from "vscode";
import { execSync } from "child_process";

export interface EditorContext {
  activeFile: string | null;
  activeFileContent: string | null;
  selection: string | null;
  selectionRange: string | null;
  language: string | null;
  workspaceRoot: string | null;
  gitDiff: string | null;
}

export function collectEditorContext(): EditorContext {
  const editor = vscode.window.activeTextEditor;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;

  let activeFile: string | null = null;
  let activeFileContent: string | null = null;
  let selection: string | null = null;
  let selectionRange: string | null = null;
  let language: string | null = null;

  if (editor) {
    activeFile = editor.document.fileName;
    language = editor.document.languageId;

    const config = vscode.workspace.getConfiguration("harness");
    if (config.get<boolean>("enableFileContext", true)) {
      const text = editor.document.getText();
      // Cap at 150k chars to avoid filling context
      activeFileContent = text.length > 150_000 ? text.slice(0, 150_000) + "\n… [file truncated]" : text;
    }

    if (!editor.selection.isEmpty) {
      selection = editor.document.getText(editor.selection);
      const start = editor.selection.start;
      const end = editor.selection.end;
      selectionRange = `lines ${start.line + 1}-${end.line + 1}`;
    }
  }

  let gitDiff: string | null = null;
  if (workspaceRoot) {
    try {
      const staged = execSync("git diff --cached", {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 3000,
      });
      const unstaged = execSync("git diff", {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 3000,
      });
      const combined = (staged + unstaged).trim();
      if (combined) {
        gitDiff = combined.length > 6000 ? combined.slice(0, 6000) + "\n… [diff truncated]" : combined;
      }
    } catch {
      // git not available or not a repo
    }
  }

  return { activeFile, activeFileContent, selection, selectionRange, language, workspaceRoot, gitDiff };
}

export function buildContextBlock(ctx: EditorContext): string {
  const parts: string[] = [];

  if (ctx.activeFile) {
    const rel = ctx.workspaceRoot
      ? ctx.activeFile.replace(ctx.workspaceRoot, "").replace(/^\//, "")
      : ctx.activeFile;

    if (ctx.selection && ctx.selectionRange) {
      parts.push(
        `### Selected code (${rel}, ${ctx.selectionRange})\n\`\`\`${ctx.language ?? ""}\n${ctx.selection}\n\`\`\``
      );
    }

    if (ctx.activeFileContent && !ctx.selection) {
      parts.push(
        `### Active file: ${rel}\n\`\`\`${ctx.language ?? ""}\n${ctx.activeFileContent}\n\`\`\``
      );
    }
  }

  if (ctx.gitDiff) {
    parts.push(`### Git diff\n\`\`\`diff\n${ctx.gitDiff}\n\`\`\``);
  }

  return parts.join("\n\n");
}
