import * as vscode from "vscode";
import { HarnessPanel } from "./harness-panel";
import { collectEditorContext } from "./context";

export function activate(context: vscode.ExtensionContext) {
  // ── Commands ────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("harness.openChat", () => {
      HarnessPanel.createOrShow(context);
    }),

    vscode.commands.registerCommand("harness.askAboutSelection", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showInformationMessage("Select some code first.");
        return;
      }
      const selection = editor.document.getText(editor.selection);
      const lang = editor.document.languageId;
      HarnessPanel.createOrShow(context);
      setTimeout(() => {
        HarnessPanel.sendPrompt(
          `Explain this ${lang} code:\n\`\`\`${lang}\n${selection}\n\`\`\``
        );
      }, 300);
    }),

    vscode.commands.registerCommand("harness.fixSelection", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showInformationMessage("Select some code first.");
        return;
      }
      const selection = editor.document.getText(editor.selection);
      const lang = editor.document.languageId;
      HarnessPanel.createOrShow(context);
      setTimeout(() => {
        HarnessPanel.sendPrompt(
          `Fix any bugs or issues in this ${lang} code. Return a unified diff:\n\`\`\`${lang}\n${selection}\n\`\`\``
        );
      }, 300);
    }),

    vscode.commands.registerCommand("harness.explainFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Open a file first.");
        return;
      }
      const fileName = editor.document.fileName.split("/").pop() ?? "this file";
      HarnessPanel.createOrShow(context);
      setTimeout(() => {
        HarnessPanel.sendPrompt(`Explain what ${fileName} does and how it fits into this codebase.`);
      }, 300);
    }),

    vscode.commands.registerCommand("harness.buildIndex", async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage("No workspace open.");
        return;
      }
      HarnessPanel.createOrShow(context);
      setTimeout(() => {
        HarnessPanel.current?.["_panel"].webview.postMessage({ type: "trigger_build_index" });
      }, 300);
    }),

    vscode.commands.registerCommand("harness.setApiKey", async () => {
      const config = vscode.workspace.getConfiguration("harness");
      const provider = config.get<string>("provider", "groq");

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
    })
  );

  // ── Status bar ──────────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(sparkle) Harness";
  statusBar.tooltip = "Open Harness chat";
  statusBar.command = "harness.openChat";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── First-run setup ─────────────────────────────────────────────────────────
  const hasSeenWelcome = context.globalState.get<boolean>("harness.welcomeSeen", false);
  if (!hasSeenWelcome) {
    context.globalState.update("harness.welcomeSeen", true);
    vscode.window
      .showInformationMessage(
        "Harness is ready. Set your API key to get started.",
        "Set API Key",
        "Open Chat"
      )
      .then((choice) => {
        if (choice === "Set API Key") {
          vscode.commands.executeCommand("harness.setApiKey");
        } else if (choice === "Open Chat") {
          vscode.commands.executeCommand("harness.openChat");
        }
      });
  }
}

export function deactivate() {}
