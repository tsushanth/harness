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
exports.applyDiffToEditor = applyDiffToEditor;
exports.applyDiffsFromResponse = applyDiffsFromResponse;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function parseDiff(diffText) {
    const fileMap = new Map();
    let currentFile = null;
    let hunks = [];
    let currentHunk = null;
    for (const line of diffText.split("\n")) {
        if (line.startsWith("+++ ")) {
            if (currentFile && hunks.length > 0)
                fileMap.set(currentFile, hunks);
            currentFile = line.slice(4).replace(/^b\//, "").trim();
            hunks = [];
            currentHunk = null;
        }
        else if (line.startsWith("@@ ")) {
            const m = line.match(/@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
            if (m) {
                currentHunk = { oldStart: parseInt(m[1], 10), oldLines: [], newLines: [] };
                hunks.push(currentHunk);
            }
        }
        else if (currentHunk) {
            if (line.startsWith("-")) {
                currentHunk.oldLines.push(line.slice(1));
            }
            else if (line.startsWith("+")) {
                currentHunk.newLines.push(line.slice(1));
            }
            else if (line.startsWith(" ")) {
                currentHunk.oldLines.push(line.slice(1));
                currentHunk.newLines.push(line.slice(1));
            }
        }
    }
    if (currentFile && hunks.length > 0)
        fileMap.set(currentFile, hunks);
    return fileMap;
}
async function applyDiffToEditor(diffText, workspaceRoot) {
    const fileMap = parseDiff(diffText);
    let applied = 0;
    const errors = [];
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
                    const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, 0));
                    const newText = hunk.newLines.map((l) => l + "\n").join("");
                    editBuilder.replace(range, newText);
                }
            });
            if (success) {
                await doc.save();
                applied++;
            }
            else {
                errors.push(`Failed to apply diff to ${filePath}`);
            }
        }
        catch (err) {
            errors.push(`${filePath}: ${String(err)}`);
        }
    }
    return { applied, errors };
}
/** Extract all ```diff blocks from a model response and apply them */
async function applyDiffsFromResponse(responseText, workspaceRoot) {
    const blocks = [...responseText.matchAll(/```diff\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
    if (blocks.length === 0) {
        return { applied: 0, errors: ["No diff blocks found in response"] };
    }
    let applied = 0;
    const errors = [];
    for (const block of blocks) {
        const result = await applyDiffToEditor(block, workspaceRoot);
        applied += result.applied;
        errors.push(...result.errors);
    }
    return { applied, errors };
}
//# sourceMappingURL=diff-applier.js.map