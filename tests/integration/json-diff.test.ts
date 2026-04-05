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
})
