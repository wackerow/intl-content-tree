import { createHash } from "node:crypto"

/**
 * SHA-256 hash truncated to 12 hex characters.
 * 12 hex chars = 48 bits, sufficient for content-addressed deduplication.
 */
export function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12)
}

/** Precomputed hash of empty string (used as sentinel for empty nodes) */
export const EMPTY_HASH = hash("")

/**
 * Hash an array of strings by joining with null separators.
 * Used for combining multiple child hashes into a parent hash.
 */
export function hashChildren(hashes: string[]): string {
  if (hashes.length === 0) return EMPTY_HASH
  return hash(hashes.join("\0"))
}

/** Normalize whitespace before hashing: trim lines, collapse blank runs, strip edges. */
export function normalizeForHash(content: string): string {
  return content
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
