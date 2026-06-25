"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectEditorContext = collectEditorContext;
exports.buildContextBlock = buildContextBlock;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
function collectEditorContext() {
    const editor = vscode.window.activeTextEditor;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    let activeFile = null;
    let activeFileContent = null;
    let selection = null;
    let selectionRange = null;
    let language = null;
    if (editor) {
        activeFile = editor.document.fileName;
        language = editor.document.languageId;
        const config = vscode.workspace.getConfiguration("harness");
        if (config.get("enableFileContext", true)) {
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
    let gitDiff = null;
    if (workspaceRoot) {
        try {
            const staged = (0, child_process_1.execSync)("git diff --cached", {
                cwd: workspaceRoot,
                encoding: "utf8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 3000,
            });
            const unstaged = (0, child_process_1.execSync)("git diff", {
                cwd: workspaceRoot,
                encoding: "utf8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 3000,
            });
            const combined = (staged + unstaged).trim();
            if (combined) {
                gitDiff = combined.length > 6000 ? combined.slice(0, 6000) + "\n… [diff truncated]" : combined;
            }
        }
        catch {
            // git not available or not a repo
        }
    }
    return { activeFile, activeFileContent, selection, selectionRange, language, workspaceRoot, gitDiff };
}
function buildContextBlock(ctx) {
    const parts = [];
    if (ctx.activeFile) {
        const rel = ctx.workspaceRoot
            ? ctx.activeFile.replace(ctx.workspaceRoot, "").replace(/^\//, "")
            : ctx.activeFile;
        if (ctx.selection && ctx.selectionRange) {
            parts.push(`### Selected code (${rel}, ${ctx.selectionRange})\n\`\`\`${ctx.language ?? ""}\n${ctx.selection}\n\`\`\``);
        }
        if (ctx.activeFileContent && !ctx.selection) {
            parts.push(`### Active file: ${rel}\n\`\`\`${ctx.language ?? ""}\n${ctx.activeFileContent}\n\`\`\``);
        }
    }
    if (ctx.gitDiff) {
        parts.push(`### Git diff\n\`\`\`diff\n${ctx.gitDiff}\n\`\`\``);
    }
    return parts.join("\n\n");
}
//# sourceMappingURL=context.js.map