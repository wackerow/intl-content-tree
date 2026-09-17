import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { serialize } from "../../src/core/tree.js"

const FIXTURES = join(import.meta.dirname, "../fixtures/markdown")
const readFixture = (name: string) =>
  readFileSync(join(FIXTURES, name), "utf8")

const CFG = {
  depth: "element" as const,
  translatableAttributes: ["title", "description", "summaryPoints"],
}

/** Frontmatter block wrapped in a fixed body, so only the block can move hashes */
const mk = (fm: string) => `---\n${fm}\n---\n\n## Title {#title}\n\nBody.\n`
const rootHash = (md: string) => serialize(parseMarkdown(md, CFG), "x.md").rootHash

describe("frontmatter hashing", () => {
  describe("sequence edits move the root hash", () => {
    it("inert sequence item added", () => {
      expect(rootHash(mk('title: "T"\ntags:\n  - "solidity"'))).not.toBe(
        rootHash(mk('title: "T"\ntags:\n  - "solidity"\n  - "vyper"'))
      )
    })

    it("translatable sequence item added", () => {
      expect(rootHash(mk('title: "T"\nsummaryPoints:\n  - "Point A"'))).not.toBe(
        rootHash(mk('title: "T"\nsummaryPoints:\n  - "Point A"\n  - "Point B"'))
      )
    })

    it("translatable sequence item rewritten", () => {
      expect(rootHash(mk('title: "T"\nsummaryPoints:\n  - "Point A"'))).not.toBe(
        rootHash(mk('title: "T"\nsummaryPoints:\n  - "Completely different"'))
      )
    })

    it("scalar rewritten (control)", () => {
      expect(rootHash(mk('title: "T"\ndescription: "one"'))).not.toBe(
        rootHash(mk('title: "T"\ndescription: "two"'))
      )
    })

    it("sequence item removed", () => {
      expect(
        rootHash(mk("topic:\n  - one\n  - two\n  - three\n  - four"))
      ).not.toBe(rootHash(mk("topic:\n  - one")))
    })

    it("sequence items reordered", () => {
      expect(rootHash(mk("tags:\n  - a\n  - b"))).not.toBe(
        rootHash(mk("tags:\n  - b\n  - a"))
      )
    })

    it("mapping value rewritten", () => {
      expect(rootHash(mk("author:\n  name: Ada"))).not.toBe(
        rootHash(mk("author:\n  name: Grace"))
      )
    })

    it("multi-line scalar rewritten", () => {
      expect(rootHash(mk("description: >-\n  one\n  two"))).not.toBe(
        rootHash(mk("description: >-\n  one\n  three"))
      )
    })
  })

  describe("equivalent YAML spellings hash identically", () => {
    it("flow and block sequences with the same items", () => {
      expect(rootHash(mk('tags: ["a", "b"]'))).toBe(
        rootHash(mk("tags:\n  - a\n  - b"))
      )
    })

    it("quoted and unquoted scalars with the same text", () => {
      expect(rootHash(mk('title: "My Page"'))).toBe(rootHash(mk("title: My Page")))
    })

    it("a trailing comment is not part of the value", () => {
      expect(rootHash(mk("lang: en # the locale"))).toBe(rootHash(mk("lang: en")))
    })

    it("an empty sequence is distinct from an empty scalar", () => {
      expect(rootHash(mk("tags: []"))).not.toBe(rootHash(mk("tags:")))
    })
  })

  describe("backward compatibility for single-line scalar frontmatter", () => {
    // Pinned against v0.3.2 output: files whose frontmatter is only
    // well-formed, unquoted, comment-free scalars must not re-translate.
    it("basic.md (group depth)", () => {
      expect(
        serialize(parseMarkdown(readFixture("basic.md")), "basic.md").rootHash
      ).toBe("b8f18f2f22ce")
    })

    it("basic.md (element depth)", () => {
      expect(
        serialize(
          parseMarkdown(readFixture("basic.md"), { depth: "element" }),
          "basic.md"
        ).rootHash
      ).toBe("1650e22aa4d6")
    })

    it("real-world.md (element depth)", () => {
      expect(
        serialize(
          parseMarkdown(readFixture("real-world.md"), { depth: "element" }),
          "real-world.md"
        ).rootHash
      ).toBe("3b47d77424ae")
    })
  })
})
