/**
 * CodebaseIndex — high-level API tying chunker + embedder + store together.
 */
import OpenAI from "openai";
import { join } from "node:path";
import { chunkDirectory } from "./chunker.js";
import { embedChunks, embedQuery, EMBEDDING_MODEL } from "./embedder.js";
import { loadStore, saveStore, search } from "./store.js";
import type { SearchResult } from "./store.js";

export { type SearchResult } from "./store.js";

const DEFAULT_INDEX_PATH = ".harness-index.json";

export class CodebaseIndex {
  private client: OpenAI;
  private indexPath: string;

  constructor(client: OpenAI, indexPath = DEFAULT_INDEX_PATH) {
    this.client = client;
    this.indexPath = indexPath;
  }

  /**
   * Build or rebuild the index for a directory.
   * Chunks the directory, embeds all chunks, saves to disk.
   */
  async build(
    rootDir: string,
    onProgress?: (phase: string, done: number, total: number) => void
  ): Promise<{ chunks: number; files: number }> {
    onProgress?.("chunking", 0, 1);
    const chunks = chunkDirectory(rootDir);
    const files = new Set(chunks.map((c) => c.path)).size;

    onProgress?.("embedding", 0, chunks.length);
    const indexed = await embedChunks(this.client, chunks, (done, total) => {
      onProgress?.("embedding", done, total);
    });

    const store = {
      model: EMBEDDING_MODEL,
      createdAt: new Date().toISOString(),
      chunks: indexed,
    };

    saveStore(this.indexPath, store);
    return { chunks: indexed.length, files };
  }

  /**
   * Search the index for chunks relevant to a query.
   * Returns formatted context string ready to inject into a prompt.
   */
  async search(query: string, topK = 5): Promise<string | null> {
    const store = loadStore(this.indexPath);
    if (!store) return null;

    const queryEmbedding = await embedQuery(this.client, query);
    const results = search(store, queryEmbedding, topK);

    if (results.length === 0) return null;

    const sections = results
      .filter((r) => r.score > 0.3) // ignore low-relevance results
      .map((r) => {
        const { path, startLine, endLine, content } = r.chunk;
        return `### ${path}:${startLine}-${endLine} (relevance: ${(r.score * 100).toFixed(0)}%)\n\`\`\`\n${content}\n\`\`\``;
      });

    return sections.length > 0
      ? `### Relevant code\n\n${sections.join("\n\n")}`
      : null;
  }

  isBuilt(): boolean {
    return loadStore(this.indexPath) !== null;
  }

  stats(): { chunks: number; files: number; model: string; createdAt: string } | null {
    const store = loadStore(this.indexPath);
    if (!store) return null;
    return {
      chunks: store.chunks.length,
      files: new Set(store.chunks.map((c) => c.path)).size,
      model: store.model,
      createdAt: store.createdAt,
    };
  }
}
