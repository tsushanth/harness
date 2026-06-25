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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const harness_panel_1 = require("./harness-panel");
const context_1 = require("./context");
function activate(context) {
    // ── Commands ────────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("harness.openChat", () => {
        harness_panel_1.HarnessPanel.createOrShow(context);
    }), vscode.commands.registerCommand("harness.askAboutSelection", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showInformationMessage("Select some code first.");
            return;
        }
        const selection = editor.document.getText(editor.selection);
        const lang = editor.document.languageId;
        harness_panel_1.HarnessPanel.createOrShow(context);
        setTimeout(() => {
            harness_panel_1.HarnessPanel.sendPrompt(`Explain this ${lang} code:\n\`\`\`${lang}\n${selection}\n\`\`\``);
        }, 300);
    }), vscode.commands.registerCommand("harness.fixSelection", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showInformationMessage("Select some code first.");
            return;
        }
        const selection = editor.document.getText(editor.selection);
        const lang = editor.document.languageId;
        harness_panel_1.HarnessPanel.createOrShow(context);
        setTimeout(() => {
            harness_panel_1.HarnessPanel.sendPrompt(`Fix any bugs or issues in this ${lang} code. Return a unified diff:\n\`\`\`${lang}\n${selection}\n\`\`\``);
        }, 300);
    }), vscode.commands.registerCommand("harness.explainFile", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage("Open a file first.");
            return;
        }
        const fileName = editor.document.fileName.split("/").pop() ?? "this file";
        harness_panel_1.HarnessPanel.createOrShow(context);
        setTimeout(() => {
            harness_panel_1.HarnessPanel.sendPrompt(`Explain what ${fileName} does and how it fits into this codebase.`);
        }, 300);
    }), vscode.commands.registerCommand("harness.buildIndex", async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("No workspace open.");
            return;
        }
        harness_panel_1.HarnessPanel.createOrShow(context);
        setTimeout(() => {
            harness_panel_1.HarnessPanel.current?.["_panel"].webview.postMessage({ type: "trigger_build_index" });
        }, 300);
    }), vscode.commands.registerCommand("harness.setApiKey", async () => {
        const config = vscode.workspace.getConfiguration("harness");
        const provider = config.get("provider", "groq");
        if (provider === "ollama") {
            vscode.window.showInformationMessage("Ollama runs locally — no API key needed.");
            return;
        }
        const label = provider === "openrouter" ? "OpenRouter" : "Groq";
        const key = await vscode.window.showInputBox({
            prompt: `Enter your ${label} API key`,
            password: true,
            placeHolder: provider === "openrouter" ? "sk-or-..." : "gsk_...",
        });
        if (key) {
            await context.secrets.store("harness.apiKey", key);
            vscode.window.showInformationMessage(`Harness: ${label} API key saved.`);
        }
        // Optional Brave Search key
        const wantBrave = await vscode.window.showQuickPick(["Yes", "No"], {
            placeHolder: "Also set a Brave Search API key for web search?",
        });
        if (wantBrave === "Yes") {
            const braveKey = await vscode.window.showInputBox({
                prompt: "Enter your Brave Search API key",
                password: true,
                placeHolder: "BSA...",
            });
            if (braveKey) {
                await context.secrets.store("harness.braveApiKey", braveKey);
                vscode.window.showInformationMessage("Harness: Brave Search API key saved.");
            }
        }
    }));
    // ── Status bar ──────────────────────────────────────────────────────────────
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = "$(sparkle) Harness";
    statusBar.tooltip = "Open Harness chat";
    statusBar.command = "harness.openChat";
    statusBar.show();
    context.subscriptions.push(statusBar);
    // ── First-run setup ─────────────────────────────────────────────────────────
    const hasSeenWelcome = context.globalState.get("harness.welcomeSeen", false);
    if (!hasSeenWelcome) {
        context.globalState.update("harness.welcomeSeen", true);
        vscode.window
            .showInformationMessage("Harness is ready. Set your API key to get started.", "Set API Key", "Open Chat")
            .then((choice) => {
            if (choice === "Set API Key") {
                vscode.commands.executeCommand("harness.setApiKey");
            }
            else if (choice === "Open Chat") {
                vscode.commands.executeCommand("harness.openChat");
            }
        });
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map