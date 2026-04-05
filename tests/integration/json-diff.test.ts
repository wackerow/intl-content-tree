import { describe, it, expect } from "vitest"
import { parseJson } from "../../src/parsers/json.js"
import { diff } from "../../src/core/diff.js"

describe("JSON drift detection", () => {
  it("no change -> all unchanged", () => {
    const json = JSON.stringify({
      greeting: "Hello",
      farewell: "Goodbye",
      count: 42,
    })
    const tree1 = parseJson(json)
    const tree2 = parseJson(json)
    const result = diff(tree1, tree2)
    expect(result.unchanged.length).toBeGreaterThan(0)
    expect(result.inertDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
  })

  it("value edit -> translatableDrift", () => {
    const before = parseJson(
      JSON.stringify({ greeting: "Hello", farewell: "Goodbye" })
    )
    const after = parseJson(
      JSON.stringify({ greeting: "Hi there", farewell: "Goodbye" })
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("greeting")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
    expect(result.unchanged.some((e) => e.id === "farewell")).toBe(true)
  })

  it("key added -> added", () => {
    const before = parseJson(JSON.stringify({ greeting: "Hello" }))
    const after = parseJson(
      JSON.stringify({ greeting: "Hello", newKey: "New value" })
    )
    const result = diff(before, after)
    expect(result.added).toHaveLength(1)
    expect(result.added[0].id).toBe("newKey")
    expect(result.unchanged.some((e) => e.id === "greeting")).toBe(true)
  })

  it("key removed -> removed", () => {
    const before = parseJson(
      JSON.stringify({ greeting: "Hello", farewell: "Goodbye" })
    )
    const after = parseJson(JSON.stringify({ greeting: "Hello" }))
    const result = diff(before, after)
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].id).toBe("farewell")
  })

  it("numeric value change -> inertDrift", () => {
    const before = parseJson(JSON.stringify({ label: "Hello", count: 42 }))
    const after = parseJson(JSON.stringify({ label: "Hello", count: 99 }))
    const result = diff(before, after)
    // Numbers are inert
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("count")
    expect(result.unchanged.some((e) => e.id === "label")).toBe(true)
  })

  // --- HTML-in-values decomposition ---

  it("href change in HTML-containing value -> inertDrift", () => {
    const before = parseJson(
      JSON.stringify({
        footnote: 'Data from <a href="https://old.com">the source</a>',
      })
    )
    const after = parseJson(
      JSON.stringify({
        footnote: 'Data from <a href="https://new.com">the source</a>',
      })
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("footnote")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("display text change in HTML-containing value -> translatableDrift", () => {
    const before = parseJson(
      JSON.stringify({
        footnote: 'Data from <a href="https://example.com">old text</a>',
      })
    )
    const after = parseJson(
      JSON.stringify({
        footnote: 'Data from <a href="https://example.com">new text</a>',
      })
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("footnote")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
    expect(result.translatableDrift[0].anchorHashChanged).toBe(false)
  })

  // --- ICU variable decomposition ---

  it("ICU variable rename -> inertDrift", () => {
    const before = parseJson(
      JSON.stringify({
        greeting: "Hello {username}, welcome back!",
      })
    )
    const after = parseJson(
      JSON.stringify({
        greeting: "Hello {displayName}, welcome back!",
      })
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("greeting")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("ICU prose change (variable same) -> translatableDrift", () => {
    const before = parseJson(
      JSON.stringify({
        greeting: "Hello {username}, welcome back!",
      })
    )
    const after = parseJson(
      JSON.stringify({
        greeting: "Hi {username}, good to see you!",
      })
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("greeting")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
    expect(result.translatableDrift[0].anchorHashChanged).toBe(false)
  })

  it("ICU plural/select syntax rename -> inertDrift", () => {
    const before = parseJson(
      JSON.stringify({
        items: "You have {count, plural, one {# item} other {# items}}",
      })
    )
    const after = parseJson(
      JSON.stringify({
        items: "You have {total, plural, one {# item} other {# items}}",
      })
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("items")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("mixed HTML + ICU in same value", () => {
    const before = parseJson(
      JSON.stringify({
        status:
          '{username} has <a href="/profile">profile</a> with {count} items',
      })
    )
    const after = parseJson(
      JSON.stringify({
        status:
          '{displayName} has <a href="/settings">profile</a> with {total} items',
      })
    )
    const result = diff(before, after)
    // Both variables AND href changed -> both hashes change -> translatableDrift
    // (ICU variables are inert, href is inert, but the variable NAMES changed which is inert)
    // Actually: anchorHash changes (href + variable names), contentHash doesn't change (prose same)
    // Wait -- {username} -> {displayName} changes inert nodes, /profile -> /settings changes inert
    // Prose "has", "profile", "with", "items" all unchanged -> contentHash unchanged
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("status")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("plain string with no HTML or ICU is not decomposed", () => {
    const before = parseJson(JSON.stringify({ greeting: "Hello world" }))
    const after = parseJson(JSON.stringify({ greeting: "Hi there" }))
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    // Should be a simple leaf node, not decomposed
    const node = before.children.find((c) => c.id === "greeting")!
    expect(node.children).toHaveLength(0)
    expect(node.value).toBe("Hello world")
  })
})
