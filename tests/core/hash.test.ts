import { describe, it, expect } from "vitest"
import { hash, hashChildren, normalizeForHash } from "../../src/core/hash.js"

describe("hash", () => {
  it("produces 12-character hex string", () => {
    const result = hash("hello world")
    expect(result).toHaveLength(12)
    expect(result).toMatch(/^[0-9a-f]{12}$/)
  })

  it("is deterministic", () => {
    expect(hash("test content")).toBe(hash("test content"))
  })

  it("produces different hashes for different input", () => {
    expect(hash("hello")).not.toBe(hash("world"))
  })

  it("handles empty string", () => {
    const result = hash("")
    expect(result).toHaveLength(12)
    expect(result).toMatch(/^[0-9a-f]{12}$/)
  })

  it("handles unicode content", () => {
    const result = hash("open source -- free software for everyone")
    expect(result).toHaveLength(12)
  })
})

describe("hashChildren", () => {
  it("combines multiple hashes deterministically", () => {
    const result = hashChildren(["abc", "def", "ghi"])
    expect(result).toHaveLength(12)
    expect(hashChildren(["abc", "def", "ghi"])).toBe(result)
  })

  it("is order-sensitive", () => {
    expect(hashChildren(["abc", "def"])).not.toBe(hashChildren(["def", "abc"]))
  })

  it("handles empty array", () => {
    const result = hashChildren([])
    expect(result).toHaveLength(12)
    expect(result).toBe(hash(""))
  })

  it("single child hash differs from direct hash", () => {
    const childHash = hash("test")
    const combined = hashChildren([childHash])
    expect(combined).not.toBe(childHash)
  })
})

describe("normalizeForHash", () => {
  it("trims trailing spaces from lines", () => {
    expect(normalizeForHash("hello   \nworld  ")).toBe("hello\nworld")
  })

  it("collapses multiple blank lines to one", () => {
    expect(normalizeForHash("hello\n\n\n\nworld")).toBe("hello\n\nworld")
  })

  it("trims leading and trailing whitespace", () => {
    expect(normalizeForHash("  \nhello\n  ")).toBe("hello")
  })

  it("preserves single blank lines", () => {
    expect(normalizeForHash("hello\n\nworld")).toBe("hello\n\nworld")
  })

  it("empty string remains empty", () => {
    expect(normalizeForHash("")).toBe("")
    expect(normalizeForHash("   ")).toBe("")
  })
})
