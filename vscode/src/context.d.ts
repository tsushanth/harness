export interface EditorContext {
    activeFile: string | null;
    activeFileContent: string | null;
    selection: string | null;
    selectionRange: string | null;
    language: string | null;
    workspaceRoot: string | null;
    gitDiff: string | null;
}
export declare function collectEditorContext(): EditorContext;
export declare function buildContextBlock(ctx: EditorContext): string;
//# sourceMappingURL=context.d.ts.map