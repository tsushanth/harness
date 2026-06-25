export declare function applyDiffToEditor(diffText: string, workspaceRoot: string | undefined): Promise<{
    applied: number;
    errors: string[];
}>;
/** Extract all ```diff blocks from a model response and apply them */
export declare function applyDiffsFromResponse(responseText: string, workspaceRoot: string | undefined): Promise<{
    applied: number;
    errors: string[];
}>;
//# sourceMappingURL=diff-applier.d.ts.map