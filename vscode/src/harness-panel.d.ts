import * as vscode from "vscode";
export declare class HarnessPanel {
    static current: HarnessPanel | undefined;
    private readonly _panel;
    private readonly _extensionUri;
    private _disposables;
    private _context;
    private _abortController;
    static createOrShow(extensionContext: vscode.ExtensionContext): void;
    static sendPrompt(prompt: string): void;
    private constructor();
    private _send;
    private _sendEditorContext;
    private _handleChat;
    private _handleBuildIndex;
    private _handleSearchCode;
    private _handleApplyDiffs;
    private _getHtmlForWebview;
    dispose(): void;
}
//# sourceMappingURL=harness-panel.d.ts.map