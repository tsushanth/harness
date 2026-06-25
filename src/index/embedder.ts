/**
 * Embed chunks using OpenAI text-embedding-3-small.
 * Works via any OpenAI-compatible endpoint (OpenRouter, direct OpenAI, etc.).
 */
import OpenAI from "openai";
import type { Chunk } from "./chunker.js";
import type { IndexedChunk } from "./store.js";

export const EMBEDDING_MODEL =
  process.env.HARNESS_EMBEDDING_MODEL ?? "text-embedding-3-small";
const BATCH_SIZE = 100; // OpenAI allows up to 2048 inputs per request

export async function embedChunks(
  client: OpenAI,
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void
): Promise<IndexedChunk[]> {
  const result: IndexedChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((c) =>
      // Truncate to ~8000 chars — embedding model token limit
      c.content.slice(0, 8_000)
    );

    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: inputs,
    });

    for (let j = 0; j < batch.length; j++) {
      result.push({
        ...batch[j]!,
        embedding: response.data[j]!.embedding,
      });
    }

    onProgress?.(Math.min(i + BATCH_SIZE, chunks.length), chunks.length);
  }

  return result;
}

export async function embedQuery(client: OpenAI, query: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query.slice(0, 8_000),
  });
  return response.data[0]!.embedding;
}
