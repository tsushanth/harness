/**
 * Walk a directory and split source files into overlapping chunks for embedding.
 */
import { readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { readdirSync } from "node:fs";

export interface Chunk {
  path: string;        // relative to repo root
  startLine: number;   // 1-indexed
  endLine: number;
  content: string;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".swift", ".kt", ".java",
  ".c", ".cpp", ".h", ".cs", ".rb", ".php",
  ".md", ".mdx", ".json", ".yaml", ".yml", ".toml",
  ".sh", ".bash", ".zsh",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".venv", "venv", "target", ".cache", "coverage",
]);

const MAX_FILE_BYTES = 150_000; // skip files larger than this
const CHUNK_LINES = 60;         // lines per chunk
const OVERLAP_LINES = 10;       // overlap between chunks

function walkDir(dir: string, root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        files.push(...walkDir(join(dir, entry.name), root));
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files;
}

export function chunkDirectory(rootDir: string): Chunk[] {
  const files = walkDir(rootDir, rootDir);
  const chunks: Chunk[] = [];

  for (const absPath of files) {
    try {
      const stat = statSync(absPath);
      if (stat.size > MAX_FILE_BYTES) continue;

      const content = readFileSync(absPath, "utf8");
      const lines = content.split("\n");
      const relPath = relative(rootDir, absPath);

      // Slide a window over the file
      for (let start = 0; start < lines.length; start += CHUNK_LINES - OVERLAP_LINES) {
        const end = Math.min(start + CHUNK_LINES, lines.length);
        const chunkLines = lines.slice(start, end);
        const chunkContent = chunkLines.join("\n").trim();
        if (!chunkContent) continue;

        chunks.push({
          path: relPath,
          startLine: start + 1,
          endLine: end,
          content: `// ${relPath}:${start + 1}-${end}\n${chunkContent}`,
        });

        if (end >= lines.length) break;
      }
    } catch {
      // skip unreadable files
    }
  }

  return chunks;
}
