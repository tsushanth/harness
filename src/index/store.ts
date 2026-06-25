/**
 * Flat JSON vector store with cosine similarity search.
 * No external DB needed — fast enough for repos up to ~50k chunks.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Chunk } from "./chunker.js";

export interface IndexedChunk extends Chunk {
  embedding: number[];
}

export interface VectorStore {
  model: string;
  createdAt: string;
  chunks: IndexedChunk[];
}

export function loadStore(indexPath: string): VectorStore | null {
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, "utf8")) as VectorStore;
  } catch {
    return null;
  }
}

export function saveStore(indexPath: string, store: VectorStore): void {
  writeFileSync(indexPath, JSON.stringify(store), "utf8");
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

export interface SearchResult {
  chunk: IndexedChunk;
  score: number;
}

export function search(
  store: VectorStore,
  queryEmbedding: number[],
  topK = 5
): SearchResult[] {
  return store.chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
