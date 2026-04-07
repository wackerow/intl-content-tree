import { describe, it, expect } from "vitest"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { parseJson } from "../../src/parsers/json.js"
import { diff, extractInertChanges } from "../../src/core/diff.js"

const ELEMENT_CFG = { depth: "element" as const }

describe("extractInertChanges", () => {
  it("extracts link URL change", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://old.com) for details.`,
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://new.com) for details.`,
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    expect(result.inertDrift).toHaveLength(1)

    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("link")
    expect(changes[0].oldValue).toBe("https://old.com")
    expect(changes[0].newValue).toBe("https://new.com")
    expect(changes[0].key).toBe("href")
  })

  it("extracts image src change", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\n![Alt](/images/old.png)`,
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      `## Section {#s}\n\n![Alt](/images/new.png)`,
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("image")
    expect(changes[0].oldValue).toBe("/images/old.png")
    expect(changes[0].newValue).toBe("/images/new.png")
    expect(changes[0].key).toBe("src")
  })

  it("extracts inline code change", () => {
    const old = parseMarkdown(
      "## Section {#s}\n\nUse the `oldFunc()` method.",
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      "## Section {#s}\n\nUse the `newFunc()` method.",
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("inline-code")
    expect(changes[0].oldValue).toBe("oldFunc()")
    expect(changes[0].newValue).toBe("newFunc()")
  })

  it("extracts HTML tag href change", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\nCheck <a href="https://old.com">the FAQ</a>.`,
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      `## Section {#s}\n\nCheck <a href="https://new.com">the FAQ</a>.`,
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("html-tag")
    expect(changes[0].oldValue).toBe("https://old.com")
    expect(changes[0].newValue).toBe("https://new.com")
    expect(changes[0].tagName).toBe("a")
  })

  it("extracts component attribute change", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\n<Demo id="abc123" />`,
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      `## Section {#s}\n\n<Demo id="def456" />`,
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("component-attribute")
    expect(changes[0].oldValue).toBe("abc123")
    expect(changes[0].newValue).toBe("def456")
    expect(changes[0].key).toBe("id")
    expect(changes[0].tagName).toBe("Demo")
  })

  it("extracts frontmatter field change", () => {
    const old = parseMarkdown(
      "---\ntitle: My Page\nimage: /old.png\nlang: en\n---\n\n## S {#s}\n\nContent.",
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      "---\ntitle: My Page\nimage: /new.png\nlang: en\n---\n\n## S {#s}\n\nContent.",
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("frontmatter-field")
    expect(changes[0].oldValue).toBe("/old.png")
    expect(changes[0].newValue).toBe("/new.png")
    expect(changes[0].key).toBe("image")
  })

  it("extracts code body change", () => {
    const old = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "```solidity",
        "uint256 x = 1;",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "```solidity",
        "uint256 x = 2;",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("code-body")
  })

  it("extracts multiple changes from one section", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://old.com) and use \`oldFunc()\`.`,
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://new.com) and use \`newFunc()\`.`,
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(2)
    const link = changes.find((c) => c.elementType === "link")
    const code = changes.find((c) => c.elementType === "inline-code")
    expect(link).toBeDefined()
    expect(link!.oldValue).toBe("https://old.com")
    expect(code).toBeDefined()
    expect(code!.oldValue).toBe("oldFunc()")
  })

  it("extracts ICU variable rename from JSON", () => {
    const old = parseJson(
      JSON.stringify({ greeting: "Hello {username}, welcome!" })
    )
    const updated = parseJson(
      JSON.stringify({ greeting: "Hello {displayName}, welcome!" })
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("icu-variable")
    expect(changes[0].oldValue).toBe("{username}")
    expect(changes[0].newValue).toBe("{displayName}")
    expect(changes[0].key).toBe("username")
  })

  it("extracts href change from JSON HTML-in-value", () => {
    const old = parseJson(
      JSON.stringify({
        note: 'See <a href="https://old.com">site</a>.',
      })
    )
    const updated = parseJson(
      JSON.stringify({
        note: 'See <a href="https://new.com">site</a>.',
      })
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].elementType).toBe("html-tag")
    expect(changes[0].oldValue).toBe("https://old.com")
    expect(changes[0].newValue).toBe("https://new.com")
  })

  it("returns empty array for no inert drift", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\nSame content.`,
      ELEMENT_CFG
    )
    const result = diff(old, old)
    const changes = extractInertChanges(old, old, result)
    expect(changes).toHaveLength(0)
  })

  it("emits per-key changes for multi-attribute html-tag", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\nCheck <a href="https://old.com" target="_blank">link</a>.`,
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      `## Section {#s}\n\nCheck <a href="https://new.com" target="_self">link</a>.`,
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    // Should emit two changes: one for href, one for target
    expect(changes).toHaveLength(2)
    const hrefChange = changes.find((c) => c.key === "href")
    const targetChange = changes.find((c) => c.key === "target")
    expect(hrefChange).toBeDefined()
    expect(hrefChange!.oldValue).toBe("https://old.com")
    expect(hrefChange!.newValue).toBe("https://new.com")
    expect(targetChange).toBeDefined()
    expect(targetChange!.oldValue).toBe("_blank")
    expect(targetChange!.newValue).toBe("_self")
  })

  it("handles non-href/non-src attribute change", () => {
    const old = parseMarkdown(
      `## Section {#s}\n\nText <span class="old-class">content</span> here.`,
      ELEMENT_CFG
    )
    const updated = parseMarkdown(
      `## Section {#s}\n\nText <span class="new-class">content</span> here.`,
      ELEMENT_CFG
    )
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].key).toBe("class")
    expect(changes[0].oldValue).toBe("old-class")
    expect(changes[0].newValue).toBe("new-class")
    expect(changes[0].tagName).toBe("span")
  })

  it("extracts deeply nested inert change (component > link)", () => {
    const md = (href: string) =>
      [
        "## Section {#s}",
        "",
        '<Alert variant="info">',
        "",
        `Visit [Our Site](${href}) for info`,
        "",
        "</Alert>",
      ].join("\n")
    const old = parseMarkdown(md("https://old.com"), ELEMENT_CFG)
    const updated = parseMarkdown(md("https://new.com"), ELEMENT_CFG)
    const result = diff(old, updated)
    const changes = extractInertChanges(old, updated, result)
    expect(changes).toHaveLength(1)
    expect(changes[0].key).toBe("href")
    expect(changes[0].oldValue).toBe("https://old.com")
    expect(changes[0].newValue).toBe("https://new.com")
  })
})
