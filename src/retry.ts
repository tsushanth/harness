// Retryable HTTP status codes from providers
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface RetryOptions {
  maxAttempts?: number; // default 4
  baseDelayMs?: number; // default 500
  maxDelayMs?: number;  // default 30_000
}

// Wraps any async fn with exponential backoff + jitter.
// Retries on network errors and retryable HTTP status codes.
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 4, baseDelayMs = 500, maxDelayMs = 30_000 } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const status = extractStatus(err);

      // Don't retry on auth errors, bad requests, or non-HTTP errors that
      // aren't network timeouts
      if (status !== null && !RETRYABLE.has(status)) throw err;

      // Last attempt — give up
      if (attempt === maxAttempts - 1) break;

      const delay = jittered(baseDelayMs * 2 ** attempt, maxDelayMs);
      await sleep(delay);
    }
  }

  throw lastError;
}

function extractStatus(err: unknown): number | null {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e["status"] === "number") return e["status"];
    if (typeof e["statusCode"] === "number") return e["statusCode"];
  }
  return null;
}

function jittered(base: number, max: number): number {
  // Full jitter: random value in [0, min(base, max)]
  return Math.random() * Math.min(base, max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
