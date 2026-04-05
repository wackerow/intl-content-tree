import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseJson } from "../../src/parsers/json.js"
import { walk } from "../../src/core/tree.js"

const FIXTURES = join(import.meta.dirname, "../fixtures/json")

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8")
}

describe("parseJson", () => {
  describe("flat.json", () => {
    const tree = parseJson(readFixture("flat.json"))

    it("creates a root node", () => {
      expect(tree.id).toBe("root")
      expect(tree.nodeType).toBe("root")
    })

    it("creates one child per top-level key", () => {
      expect(tree.children).toHaveLength(6)
      expect(tree.children[0].id).toBe("page-title")
      expect(tree.children[0].value).toBe("Getting Started")
    })

    it("classifies string values as translatable", () => {
      for (const child of tree.children) {
        expect(child.contentType).toBe("translatable")
        expect(child.elementType).toBe("json-value")
      }
    })

    it("computes hashes", () => {
      for (const node of walk(tree)) {
        expect(node.contentHash).toHaveLength(12)
        expect(node.anchorHash).toHaveLength(12)
      }
    })

    it("is deterministic", () => {
      const tree2 = parseJson(readFixture("flat.json"))
      expect(tree.contentHash).toBe(tree2.contentHash)
    })
  })

  describe("nested.json", () => {
    const tree = parseJson(readFixture("nested.json"))

    it("creates sections for nested objects", () => {
      const hero = tree.children.find((c) => c.id === "hero")!
      expect(hero).toBeDefined()
      expect(hero.nodeType).toBe("section")
      expect(hero.children).toHaveLength(3)
    })

    it("deeply nests objects", () => {
      const features = tree.children.find((c) => c.id === "features")!
      const speed = features.children.find((c) => c.id === "speed")!
      expect(speed).toBeDefined()
      expect(speed.children).toHaveLength(2)

      const title = speed.children.find((c) => c.id === "title")!
      expect(title.value).toBe("Fast")
    })
  })

  describe("html-in-values.json", () => {
    const tree = parseJson(readFixture("html-in-values.json"))

    it("decomposes HTML in string values into children", () => {
      const welcome = tree.children.find((c) => c.id === "welcome")!
      expect(welcome.contentType).toBe("mixed")
      expect(welcome.children.length).toBeGreaterThan(0)
      // description has <a href="...">, which should decompose into a link-like html-tag
      const desc = tree.children.find((c) => c.id === "description")!
      expect(desc.contentType).toBe("mixed")
      const htmlTag = desc.children.find((c) => c.elementType === "html-tag")
      expect(htmlTag).toBeDefined()
      expect(htmlTag!.meta?.href).toBe("/docs")
    })

    it("classifies plain values as translatable", () => {
      const plain = tree.children.find((c) => c.id === "plain")!
      expect(plain.contentType).toBe("translatable")
      expect(plain.meta?.containsHtml).toBeUndefined()
    })
  })

  describe("markdown-in-values.json", () => {
    const tree = parseJson(readFixture("markdown-in-values.json"))

    it("detects markdown in multi-line values", () => {
      const rich = tree.children.find((c) => c.id === "rich-content")!
      expect(rich).toBeDefined()
      expect(rich.meta?.containsMarkdown).toBe("true")
      expect(rich.children.length).toBeGreaterThan(0)
    })

    it("treats single-line values as plain strings", () => {
      const intro = tree.children.find((c) => c.id === "intro")!
      expect(intro.contentType).toBe("translatable")
      expect(intro.children).toHaveLength(0)
    })
  })

  describe("structural-changes.json", () => {
    const tree = parseJson(readFixture("structural-changes.json"))

    it("parses all keys", () => {
      expect(tree.children).toHaveLength(4)
      const ids = tree.children.map((c) => c.id)
      expect(ids).toContain("kept")
      expect(ids).toContain("modified")
      expect(ids).toContain("removed-key")
      expect(ids).toContain("renamed-old")
    })
  })
})
