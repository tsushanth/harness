#!/usr/bin/env npx tsx
/**
 * Build or rebuild the codebase index for semantic search.
 *
 * Usage:
 *   OPENAI_API_KEY=... npx tsx scripts/build-index.ts [directory] [index-path]
 *   OPENROUTER_API_KEY=... npx tsx scripts/build-index.ts ./my-project
 *
 * The index is saved to .harness-index.json by default.
 * Run this once, then use codebaseSearchProvider in your harness runs.
 */
import OpenAI from "openai";
import { CodebaseIndex } from "../src/index/codebase.js";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENROUTER_KEY && !OPENAI_KEY) {
  console.error("Error: set OPENAI_API_KEY or OPENROUTER_API_KEY");
  process.exit(1);
}

// Note: text-embedding-3-small is an OpenAI model.
// Via OpenRouter it's available as "openai/text-embedding-3-small".
// Via direct OpenAI it's "text-embedding-3-small".
const client = OPENAI_KEY
  ? new OpenAI({ apiKey: OPENAI_KEY })
  : new OpenAI({
      apiKey: OPENROUTER_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

const rootDir = process.argv[2] ?? ".";
const indexPath = process.argv[3] ?? ".harness-index.json";

// OpenRouter uses a prefixed model name for embeddings
if (!OPENAI_KEY) {
  // Patch the embedder model name for OpenRouter
  process.env.HARNESS_EMBEDDING_MODEL = "openai/text-embedding-3-small";
}

const index = new CodebaseIndex(client, indexPath);

console.log(`\nBuilding codebase index`);
console.log(`  Directory : ${rootDir}`);
console.log(`  Index     : ${indexPath}`);
console.log(`  Model     : text-embedding-3-small\n`);

const start = Date.now();

const { chunks, files } = await index.build(rootDir, (phase, done, total) => {
  if (phase === "chunking") {
    process.stdout.write("  Chunking files...\n");
  } else {
    process.stdout.write(`\r  Embedding: ${done}/${total} chunks`);
  }
});

const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Index built`);
console.log(`  Files   : ${files}`);
console.log(`  Chunks  : ${chunks}`);
console.log(`  Time    : ${elapsed}s`);
console.log(`  Saved   : ${indexPath}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
