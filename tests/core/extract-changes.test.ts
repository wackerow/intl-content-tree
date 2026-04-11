import { describe, it, expect } from "vitest"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { parseJson } from "../../src/parsers/json.js"
import { extractChanges } from "../../src/core/extract.js"

const ELEMENT_CFG = { depth: "element" as const }

describe("extractChanges", () => {
  it("returns empty changeset for identical trees", () => {
    const md = `## Section {#s}\n\nSome content.`
    const tree1 = parseMarkdown(md, ELEMENT_CFG)
    const tree2 = parseMarkdown(md, ELEMENT_CFG)
    const result = extractChanges(tree1, tree2)
    expect(result.changes).toHaveLength(0)
    expect(result.relocations).toHaveLength(0)
    expect(result.sectionRenames).toHaveLength(0)
  })

  // --- Update changes ---

  it("detects link URL update", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://old.com) here.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://new.com) here.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const urlChange = result.changes.find((c) => c.key === "href")
    expect(urlChange).toBeDefined()
    expect(urlChange!.action).toBe("update")
    expect(urlChange!.oldValue).toBe("https://old.com")
    expect(urlChange!.newValue).toBe("https://new.com")
  })

  it("detects prose text update", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nOld text here.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nNew text here.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const proseChange = result.changes.find(
      (c) => c.elementType === "prose" && c.action === "update"
    )
    expect(proseChange).toBeDefined()
    expect(proseChange!.contentType).toBe("translatable")
  })

  it("detects inline code update", () => {
    const before = parseMarkdown(
      "## Section {#s}\n\nUse `oldFunc()` here.",
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      "## Section {#s}\n\nUse `newFunc()` here.",
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const codeChange = result.changes.find(
      (c) => c.elementType === "inline-code"
    )
    expect(codeChange).toBeDefined()
    expect(codeChange!.oldValue).toBe("oldFunc()")
    expect(codeChange!.newValue).toBe("newFunc()")
  })

  it("detects component attribute update", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\n<Demo id="abc" />`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\n<Demo id="def" />`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const attrChange = result.changes.find((c) => c.key === "id")
    expect(attrChange).toBeDefined()
    expect(attrChange!.action).toBe("update")
    expect(attrChange!.oldValue).toBe("abc")
    expect(attrChange!.newValue).toBe("def")
  })

  it("detects frontmatter field update", () => {
    const before = parseMarkdown(
      "---\ntitle: Old Title\nlang: en\n---\n\n## S {#s}\n\nContent.",
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      "---\ntitle: New Title\nlang: en\n---\n\n## S {#s}\n\nContent.",
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const titleChange = result.changes.find(
      (c) => c.elementType === "frontmatter-field"
    )
    expect(titleChange).toBeDefined()
    expect(titleChange!.action).toBe("update")
    expect(titleChange!.oldValue).toBe("Old Title")
    expect(titleChange!.newValue).toBe("New Title")
  })

  // --- Add/remove changes ---

  it("detects added code fence", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nContent here.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "Content here.",
        "",
        "```python",
        "print('hello')",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const added = result.changes.filter((c) => c.action === "add")
    expect(added.length).toBeGreaterThan(0)
    expect(added.some((c) => c.elementType === "code-body")).toBe(true)
  })

  it("detects removed component", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nContent.\n\n<Divider />\n\n## Next {#next}\n\nOther.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nContent.\n\n## Next {#next}\n\nOther.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const removed = result.changes.filter((c) => c.action === "remove")
    expect(removed.length).toBeGreaterThan(0)
  })

  it("detects added section", () => {
    const before = parseMarkdown(
      `## First {#first}\n\nContent.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## First {#first}\n\nContent.\n\n## Second {#second}\n\nNew content.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const added = result.changes.filter((c) => c.action === "add")
    expect(added.some((c) => c.path.startsWith("second"))).toBe(true)
  })

  // --- Section renames ---

  it("detects pure section rename", () => {
    const before = parseMarkdown(
      `## Old Name {#old-id}\n\nSame content.\n\n## Other {#other}\n\nOther.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## New Name {#new-id}\n\nSame content.\n\n## Other {#other}\n\nOther.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    expect(result.sectionRenames).toHaveLength(1)
    expect(result.sectionRenames[0].oldId).toBe("old-id")
    expect(result.sectionRenames[0].newId).toBe("new-id")
    expect(result.sectionRenames[0].labelHashChanged).toBe(true)
  })

  it("detects section rename with modifications inside", () => {
    const before = parseMarkdown(
      `## Old Name {#old-id}\n\nSame content.\n\nRead [docs](https://old.com).`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## New Name {#new-id}\n\nSame content.\n\nRead [docs](https://new.com).`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    // Section rename detected by overlapping child hashes
    expect(result.sectionRenames).toHaveLength(1)
    expect(result.sectionRenames[0].oldId).toBe("old-id")
    expect(result.sectionRenames[0].newId).toBe("new-id")
    // URL change within the renamed section should also be detected
    const urlChange = result.changes.find((c) => c.key === "href")
    expect(urlChange).toBeDefined()
    expect(urlChange!.oldValue).toBe("https://old.com")
    expect(urlChange!.newValue).toBe("https://new.com")
  })

  // --- Relocations ---

  it("detects discrete node relocated between sections", () => {
    // Components and code fences are discrete nodes that can be tracked
    // (prose merges with adjacent text, so relocation only works for discrete elements)
    const before = parseMarkdown(
      [
        "## Section A {#a}",
        "",
        "Content here.",
        "",
        '<Demo id="moveme" />',
        "",
        "## Section B {#b}",
        "",
        "Other content.",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section A {#a}",
        "",
        "Content here.",
        "",
        "## Section B {#b}",
        "",
        "Other content.",
        "",
        '<Demo id="moveme" />',
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    expect(result.relocations.length).toBeGreaterThanOrEqual(1)
    const relocation = result.relocations.find(
      (r) => r.oldPath.startsWith("a/") && r.newPath.startsWith("b/")
    )
    expect(relocation).toBeDefined()
  })

  // --- Multiple changes ---

  it("detects multiple changes in one section", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://old.com) and use \`oldFunc()\`.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nSee [docs](https://new.com) and use \`newFunc()\`.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    expect(result.changes.length).toBeGreaterThanOrEqual(2)
    expect(result.changes.some((c) => c.key === "href")).toBe(true)
    expect(
      result.changes.some((c) => c.elementType === "inline-code")
    ).toBe(true)
  })

  // --- JSON ---

  it("detects JSON value update", () => {
    const before = parseJson(
      JSON.stringify({ greeting: "Hello", farewell: "Goodbye" })
    )
    const after = parseJson(
      JSON.stringify({ greeting: "Hi there", farewell: "Goodbye" })
    )
    const result = extractChanges(before, after)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].action).toBe("update")
    expect(result.changes[0].oldValue).toBe("Hello")
    expect(result.changes[0].newValue).toBe("Hi there")
  })

  it("detects JSON key added", () => {
    const before = parseJson(JSON.stringify({ greeting: "Hello" }))
    const after = parseJson(
      JSON.stringify({ greeting: "Hello", newKey: "New value" })
    )
    const result = extractChanges(before, after)
    const added = result.changes.filter((c) => c.action === "add")
    expect(added).toHaveLength(1)
    expect(added[0].path).toBe("newKey")
  })

  it("detects JSON key removed", () => {
    const before = parseJson(
      JSON.stringify({ greeting: "Hello", farewell: "Goodbye" })
    )
    const after = parseJson(JSON.stringify({ greeting: "Hello" }))
    const result = extractChanges(before, after)
    const removed = result.changes.filter((c) => c.action === "remove")
    expect(removed).toHaveLength(1)
    expect(removed[0].path).toBe("farewell")
  })

  // --- Real-world: security/index.md 6 changes ---

  it("handles Doc's 6 inert changes on security/index.md pattern", () => {
    // Simulates the structure of the 6 test changes
    const before = parseMarkdown(
      [
        "## Intro {#intro}",
        "",
        "Some prose.",
        "",
        '<DocLink href="/what-is-ethereum/">',
        "  What is it?",
        "</DocLink>",
        "",
        "### Crypto {#crypto-security}",
        "",
        "More prose.",
        "",
        "<Divider />",
        "",
        "## Wallet {#wallet}",
        "",
        "Wallet content.",
        "",
        "#### Screenshots {#screenshot-keys}",
        "",
        "Screenshot content.",
        "",
        "## Scams {#scams}",
        "",
        '<AlertEmoji text=":lock:"/>',
        "",
        "Scam content.",
      ].join("\n"),
      ELEMENT_CFG
    )

    const after = parseMarkdown(
      [
        "## Intro {#intro}",
        "",
        "Some prose.",
        "",
        '<DocLink href="/what-is-ethereum/" className="test">',
        "  What is it?",
        "</DocLink>",
        "",
        "### Test Change {#test-change}",
        "",
        "More prose.",
        "",
        "## Wallet {#wallet}",
        "",
        "Wallet content.",
        "",
        "```tsx",
        'const x = "hello"',
        "```",
        "",
        "#### Screenshots {#screenshot-keys}",
        "",
        "Screenshot content.",
        "",
        "## Scams {#scams}",
        "",
        '<AlertEmoji text="lock-emoji"/>',
        "",
        "Scam content.",
      ].join("\n"),
      ELEMENT_CFG
    )

    const result = extractChanges(before, after)

    // Section rename: crypto-security -> test-change
    expect(result.sectionRenames).toHaveLength(1)
    expect(result.sectionRenames[0].oldId).toBe("crypto-security")
    expect(result.sectionRenames[0].newId).toBe("test-change")

    // No translatable content changed (all changes are inert/structural)
    const translatableUpdates = result.changes.filter(
      (c) =>
        c.action === "update" &&
        c.contentType === "translatable"
    )
    expect(translatableUpdates).toHaveLength(0)
  })

  // --- Skips unchanged subtrees ---

  it("skips unchanged subtrees efficiently", () => {
    const md = [
      "## Section A {#a}",
      "",
      "Lots of content here that should be skipped.",
      "",
      "With [links](https://example.com) and `code` and more.",
      "",
      "## Section B {#b}",
      "",
      "This section has a [changed link](https://old.com).",
    ].join("\n")
    const before = parseMarkdown(md, ELEMENT_CFG)
    const after = parseMarkdown(
      md.replace("https://old.com", "https://new.com"),
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    // Only changes in section B, nothing from section A
    expect(result.changes.every((c) => c.path.startsWith("b/"))).toBe(true)
    expect(result.changes.length).toBeGreaterThan(0)
  })

  // --- Reviewer-flagged edge cases ---

  it("handles empty section (heading only, no body)", () => {
    const md = [
      "## Empty {#empty}",
      "",
      "## Next {#next}",
      "",
      "Content.",
    ].join("\n")
    const tree1 = parseMarkdown(md, ELEMENT_CFG)
    const tree2 = parseMarkdown(md, ELEMENT_CFG)
    const result = extractChanges(tree1, tree2)
    expect(result.changes).toHaveLength(0)
    expect(result.relocations).toHaveLength(0)
    expect(result.sectionRenames).toHaveLength(0)
  })

  it("handles component gaining children (self-closing to block)", () => {
    // Self-closing <Demo id="abc" /> has 1 child (attr:id)
    // Block <Demo id="abc">content</Demo> has 2 children (attr:id + prose)
    // The added prose should be detected
    const before = parseMarkdown(
      `## Section {#s}\n\n<Demo id="abc" />`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#s}",
        "",
        '<Demo id="abc">',
        "",
        "Now has content inside.",
        "",
        "</Demo>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    const added = result.changes.filter((c) => c.action === "add")
    expect(added.length).toBeGreaterThan(0)
    expect(added.some((c) => c.contentType === "translatable")).toBe(true)
  })

  it("sections with zero overlapping children are NOT detected as renames", () => {
    const before = parseMarkdown(
      `## Old {#old-section}\n\nCompletely different content.\n\n## Other {#other}\n\nStays.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## New {#new-section}\n\nTotally unrelated text.\n\n## Other {#other}\n\nStays.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    // No renames -- content is completely different
    expect(result.sectionRenames).toHaveLength(0)
    // Should have removals and additions instead
    const removed = result.changes.filter((c) => c.action === "remove")
    const added = result.changes.filter((c) => c.action === "add")
    expect(removed.length).toBeGreaterThan(0)
    expect(added.length).toBeGreaterThan(0)
  })

  it("sectionRename includes parentPath", () => {
    const before = parseMarkdown(
      `## Parent {#parent}\n\n### Old Sub {#old-sub}\n\nContent.\n\n## Other {#other}\n\nStays.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Parent {#parent}\n\n### New Sub {#new-sub}\n\nContent.\n\n## Other {#other}\n\nStays.`,
      ELEMENT_CFG
    )
    const result = extractChanges(before, after)
    expect(result.sectionRenames).toHaveLength(1)
    expect(result.sectionRenames[0].parentPath).toBe("parent")
  })
})
