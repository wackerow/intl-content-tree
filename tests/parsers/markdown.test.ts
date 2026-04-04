import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { walk } from "../../src/core/tree.js"

const FIXTURES = join(import.meta.dirname, "../fixtures/markdown")

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8")
}

describe("parseMarkdown", () => {
  describe("basic.md", () => {
    const tree = parseMarkdown(readFixture("basic.md"))

    it("creates a root node", () => {
      expect(tree.id).toBe("root")
      expect(tree.nodeType).toBe("root")
    })

    it("parses frontmatter fields", () => {
      const fmNodes = tree.children.filter((c) =>
        c.id.startsWith("frontmatter:")
      )
      expect(fmNodes.length).toBeGreaterThanOrEqual(3)

      const titleNode = fmNodes.find((n) => n.id === "frontmatter:title")
      expect(titleNode).toBeDefined()
      expect(titleNode!.contentType).toBe("translatable")
      expect(titleNode!.value).toBe("Introduction to Open Source")

      const langNode = fmNodes.find((n) => n.id === "frontmatter:lang")
      expect(langNode).toBeDefined()
      expect(langNode!.contentType).toBe("inert")
    })

    it("creates sections from headings with {#id}", () => {
      const sections = tree.children.filter((c) => c.nodeType === "section")
      expect(sections.length).toBe(2)
      expect(sections[0].id).toBe("what-is-open-source")
      expect(sections[1].id).toBe("how-does-contributing-work")
    })

    it("strips heading ID from label text", () => {
      const section = tree.children.find((c) => c.id === "what-is-open-source")!
      const label = section.children.find((c) => c.id === "_label")!
      expect(label.value).not.toContain("{#")
      expect(label.value).toBe("What is open source?")
    })

    it("nests h3 under h2", () => {
      const h2 = tree.children.find((c) => c.id === "how-does-contributing-work")!
      const h3 = h2.children.find((c) => c.id === "code-review")
      expect(h3).toBeDefined()
      expect(h3!.nodeType).toBe("section")
    })

    it("computes hashes for all nodes", () => {
      for (const node of walk(tree)) {
        expect(node.contentHash).toHaveLength(12)
        expect(node.anchorHash).toHaveLength(12)
      }
    })

    it("is deterministic", () => {
      const tree2 = parseMarkdown(readFixture("basic.md"))
      expect(tree.contentHash).toBe(tree2.contentHash)
      expect(tree.anchorHash).toBe(tree2.anchorHash)
    })
  })

  describe("nested-headings.md", () => {
    const tree = parseMarkdown(readFixture("nested-headings.md"))

    it("creates correct nesting hierarchy", () => {
      const perf = tree.children.find((c) => c.id === "performance")!
      expect(perf).toBeDefined()

      const caching = perf.children.find((c) => c.id === "caching")
      expect(caching).toBeDefined()

      const browserCache = caching!.children.find(
        (c) => c.id === "browser-caching"
      )
      expect(browserCache).toBeDefined()

      const serverCache = caching!.children.find(
        (c) => c.id === "server-caching"
      )
      expect(serverCache).toBeDefined()

      const lazyLoading = perf.children.find(
        (c) => c.id === "lazy-loading"
      )
      expect(lazyLoading).toBeDefined()
    })
  })

  describe("code-fences.md", () => {
    const tree = parseMarkdown(readFixture("code-fences.md"))

    it("parses code fences as inert code-body", () => {
      const section = tree.children.find(
        (c) => c.id === "smart-contract-example"
      )!
      const codeBodies = [...walk(section)].filter(
        (n) => n.elementType === "code-body"
      )
      expect(codeBodies.length).toBeGreaterThanOrEqual(2)
      expect(codeBodies[0].contentType).toBe("inert")
      expect(codeBodies[0].meta?.language).toBe("solidity")
    })

    it("parses prose fences as translatable", () => {
      const section = tree.children.find((c) => c.id === "prose-fence")!
      const proseFences = [...walk(section)].filter(
        (n) => n.elementType === "prose" && n.meta?.language
      )
      expect(proseFences.length).toBe(2)
      expect(proseFences[0].contentType).toBe("translatable")
      expect(proseFences[0].meta?.language).toBe("md")
      expect(proseFences[1].meta?.language).toBe("text")
    })

    it("extracts comments from code in element mode", () => {
      const tree2 = parseMarkdown(readFixture("code-fences.md"), {
        depth: "element",
      })
      const comments = [...walk(tree2)].filter(
        (n) => n.elementType === "code-comment"
      )
      expect(comments.length).toBeGreaterThan(0)
      expect(comments[0].contentType).toBe("translatable")
    })
  })

  describe("components.md", () => {
    const tree = parseMarkdown(readFixture("components.md"))

    it("parses JSX components", () => {
      const section = tree.children.find((c) => c.id === "using-components")!
      const components = [...walk(section)].filter(
        (n) => n.elementType === "component"
      )
      expect(components.length).toBeGreaterThanOrEqual(2)
    })

    it("parses self-closing components", () => {
      const section = tree.children.find((c) => c.id === "using-components")!
      const allNodes = [...walk(section)]
      const button = allNodes.find(
        (n) => n.elementType === "component" && n.meta?.tagName === "Button"
      )
      expect(button).toBeDefined()
    })

    it("recursively parses component children", () => {
      const section = tree.children.find((c) => c.id === "using-components")!
      const expandable = [...walk(section)].find(
        (n) => n.elementType === "component" && n.meta?.tagName === "ExpandableCard"
      )
      expect(expandable).toBeDefined()
      expect(expandable!.children.length).toBeGreaterThan(0)
    })
  })

  describe("empty-sections.md", () => {
    const tree = parseMarkdown(readFixture("empty-sections.md"))

    it("handles sections with no content gracefully", () => {
      const sections = tree.children.filter((c) => c.nodeType === "section")
      expect(sections.length).toBe(4)

      const empty = sections.find((s) => s.id === "empty-section")!
      // Empty section should have just the heading label
      expect(empty.children.length).toBe(1)
      expect(empty.children[0].id).toBe("_label")
    })
  })

  describe("indented-fences.md", () => {
    const tree = parseMarkdown(readFixture("indented-fences.md"))

    it("parses code fences with indentation", () => {
      const section = tree.children.find((c) => c.id === "list-with-code")!
      const codeBodies = [...walk(section)].filter(
        (n) => n.elementType === "code-body"
      )
      expect(codeBodies.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("html-tags.md", () => {
    const tree = parseMarkdown(readFixture("html-tags.md"))

    it("parses embedded HTML in markdown", () => {
      const section = tree.children.find((c) => c.id === "html-in-markdown")!
      expect(section).toBeDefined()
      expect(section.contentHash).toHaveLength(12)
    })

    it("handles self-closing HTML tags", () => {
      const section = tree.children.find((c) => c.id === "html-in-markdown")!
      const allNodes = [...walk(section)]
      const components = allNodes.filter((n) => n.elementType === "component")
      expect(components.length).toBeGreaterThan(0)
    })
  })

  describe("duplicate-elements.md", () => {
    const tree = parseMarkdown(readFixture("duplicate-elements.md"))

    it("handles duplicate inline code without collision", () => {
      const section = tree.children.find(
        (c) => c.id === "duplicate-elements"
      )!
      expect(section).toBeDefined()
      // Tree should exist and have content hashes
      expect(section.contentHash).toHaveLength(12)
    })
  })

  describe("images.md", () => {
    const tree = parseMarkdown(readFixture("images.md"), {
      depth: "element",
    })

    it("parses images with alt text as mixed content", () => {
      const images = [...walk(tree)].filter((n) => n.elementType === "image")
      expect(images.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("tables.md", () => {
    const tree = parseMarkdown(readFixture("tables.md"))

    it("includes table content in section prose", () => {
      const section = tree.children.find(
        (c) => c.id === "database-comparison"
      )!
      expect(section).toBeDefined()
      const proseNodes = section.children.filter(
        (c) => c.elementType === "prose"
      )
      expect(proseNodes.length).toBeGreaterThan(0)
      // Table content should be in the prose
      const allText = proseNodes.map((n) => n.value).join("\n")
      expect(allText).toContain("PostgreSQL")
    })
  })

  describe("hash stability", () => {
    it("whitespace changes do not affect hashes", () => {
      const content1 = `## Test {#test}\n\nHello world\n`
      const content2 = `## Test {#test}\n\nHello world   \n\n\n`
      const tree1 = parseMarkdown(content1)
      const tree2 = parseMarkdown(content2)
      expect(tree1.contentHash).toBe(tree2.contentHash)
    })

    it("heading ID is stripped before hashing heading text", () => {
      const tree = parseMarkdown(`## My Heading {#my-heading}\n\nContent here`)
      const section = tree.children.find((c) => c.id === "my-heading")!
      const label = section.children.find((c) => c.id === "_label")!
      expect(label.value).toBe("My Heading")
      expect(label.value).not.toContain("{#")
    })

    it("auto-generates slug IDs when no {#id} is present", () => {
      const tree = parseMarkdown("## My Cool Heading\n\nSome content")
      const section = tree.children.find((c) =>
        c.id.startsWith("_auto:")
      )
      expect(section).toBeDefined()
      expect(section!.id).toBe("_auto:my-cool-heading")
    })
  })
})
