import { describe, it, expect } from "vitest"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { diff, getContainingSection } from "../../src/core/diff.js"
import { createNode, computeHashes, serialize, deserialize } from "../../src/core/tree.js"

const ELEMENT_CFG = { depth: "element" as const }

describe("structuralDrift classification", () => {
  // --- Doc's 6 real-world cases from security/index.md ---

  it("case 1: wrapped word in link -> translatableDrift (prose split)", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nRising threat levels require attention.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\n[Rising](/test/) threat levels require attention.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Prose text changed (split into link + prose) -> translatableDrift
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("s")
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("case 2: changed href -> inertDrift", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nRead [about it](/what-is-ethereum/) here.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nRead [about it](/what-is-ethereum/test/) here.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("s")
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("case 3: removed <Divider /> from section -> structuralDrift", () => {
    // Divider is the only non-prose child; prose stays identical
    const before = parseMarkdown(
      `## Section {#s}\n\nProse content here.\n\n<Divider />\n\n## Next {#next}\n\nOther.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nProse content here.\n\n## Next {#next}\n\nOther.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Divider removed from section s, but its prose is unchanged -> structuralDrift
    expect(result.structuralDrift).toHaveLength(1)
    expect(result.structuralDrift[0].id).toBe("s")
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("case 4: added code fence (inert) -> structuralDrift", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nSome content here.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "Some content here.",
        "",
        "```python",
        "print('hello')",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Code fence added (inert), prose unchanged -> structuralDrift
    expect(result.structuralDrift).toHaveLength(1)
    expect(result.structuralDrift[0].id).toBe("s")
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("case 5: added className to component -> inertDrift", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\n<DocLink href="/docs/">Read docs</DocLink>`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\n<DocLink href="/docs/" className="test">Read docs</DocLink>`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Only inert attribute added -> inertDrift
    expect(result.inertDrift).toHaveLength(1)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("case 6: changed component attribute text -> depends on translatableAttributes", () => {
    // Emoji text in a component attribute -- if the attr is not in translatableAttributes,
    // it's inert. If it is, it's translatable.
    const before = parseMarkdown(
      `## Section {#s}\n\n<AlertEmoji emoji=":lock:" />`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\n<AlertEmoji emoji="🔒" />`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // "emoji" is not in default translatableAttributes -> inert attr -> inertDrift
    expect(result.inertDrift).toHaveLength(1)
    expect(result.translatableDrift).toHaveLength(0)
  })

  // --- Additional structuralDrift edge cases ---

  it("multiple inert nodes removed -> structuralDrift", () => {
    // Two Dividers removed but prose stays as one block (before next heading)
    const before = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "Prose here.",
        "",
        "<Divider />",
        "",
        "<Demo id=\"123\" />",
        "",
        "## Next {#next}",
        "",
        "Other.",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "Prose here.",
        "",
        "## Next {#next}",
        "",
        "Other.",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.structuralDrift).toHaveLength(1)
    expect(result.structuralDrift[0].id).toBe("s")
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("prose added -> translatableDrift (not structural)", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nExisting prose.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nExisting prose.\n\nNew paragraph added.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // New translatable content added -> translatableDrift
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("prose removed -> translatableDrift (not structural)", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nFirst paragraph.\n\nSecond paragraph.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\nFirst paragraph.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("inert node added + inert node removed -> structuralDrift", () => {
    const before = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "Prose here.",
        "",
        "```python",
        "old_code()",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "Prose here.",
        "",
        "<Demo id=\"abc\" />",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Code fence removed, component added -- but prose unchanged
    expect(result.structuralDrift).toHaveLength(1)
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("mixed: inert added + prose changed -> translatableDrift", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\nOld prose.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#s}",
        "",
        "New prose.",
        "",
        "```python",
        "code()",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Both structural change AND translatable change -> translatableDrift wins
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("no change -> unchanged (structuralDrift not triggered)", () => {
    const md = `## Section {#s}\n\nSame content.\n\n<Divider />`
    const tree1 = parseMarkdown(md, ELEMENT_CFG)
    const tree2 = parseMarkdown(md, ELEMENT_CFG)
    const result = diff(tree1, tree2)
    expect(result.unchanged.length).toBeGreaterThan(0)
    expect(result.structuralDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
  })

  // --- Reviewer-flagged edge cases ---

  it("heading change + Divider removal -> structuralDrift (label excluded from comparison)", () => {
    const before = parseMarkdown(
      [
        "## Old Heading {#s}",
        "",
        "Prose stays same.",
        "",
        "<Divider />",
        "",
        "## Next {#next}",
        "",
        "Other.",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## New Heading {#s}",
        "",
        "Prose stays same.",
        "",
        "## Next {#next}",
        "",
        "Other.",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Divider removed (structural) + heading changed (label only)
    // _label is excluded from translatable hash comparison
    // so this should be structuralDrift with labelHashChanged
    expect(result.structuralDrift).toHaveLength(1)
    expect(result.structuralDrift[0].id).toBe("s")
    expect(result.structuralDrift[0].labelHashChanged).toBe(true)
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("section with only an image (mixed leaf) -> alt text change is translatableDrift", () => {
    const before = parseMarkdown(
      `## Section {#s}\n\n![Old alt text](/images/diagram.png)`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#s}\n\n![New alt text](/images/diagram.png)`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("s")
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("component translatable attribute change -> translatableDrift", () => {
    const before = parseMarkdown(
      [
        "## Section {#s}",
        "",
        '<Card title="Old title">',
        "",
        "Content.",
        "",
        "</Card>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#s}",
        "",
        '<Card title="New title">',
        "",
        "Content.",
        "",
        "</Card>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("s")
  })

  it("empty section (heading only) -> unchanged", () => {
    const md = [
      "## Empty {#empty}",
      "",
      "## Next {#next}",
      "",
      "Content.",
    ].join("\n")
    const tree1 = parseMarkdown(md, ELEMENT_CFG)
    const tree2 = parseMarkdown(md, ELEMENT_CFG)
    const result = diff(tree1, tree2)
    expect(result.unchanged.some((e) => e.id === "empty")).toBe(true)
    expect(result.structuralDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
  })

  // --- Deserialized manifest scenario (critical real-world bug) ---

  it("structuralDrift works when old tree is deserialized from manifest", () => {
    // Simulate the real pipeline: old tree comes from serialize -> deserialize
    // (which sets contentType: "mixed" on all nodes)
    const beforeMd = [
      "## Section {#s}",
      "",
      "Prose content here.",
      "",
      "<Divider />",
      "",
      "## Next {#next}",
      "",
      "Other.",
    ].join("\n")
    const afterMd = [
      "## Section {#s}",
      "",
      "Prose content here.",
      "",
      "## Next {#next}",
      "",
      "Other.",
    ].join("\n")

    const beforeTree = parseMarkdown(beforeMd, ELEMENT_CFG)
    // Simulate manifest round-trip (loses contentType)
    const manifest = serialize(beforeTree, "test.md")
    const oldTree = deserialize(manifest)
    computeHashes(oldTree)

    const newTree = parseMarkdown(afterMd, ELEMENT_CFG)
    const result = diff(oldTree, newTree)

    // Divider removed, prose unchanged -> structuralDrift (NOT translatableDrift)
    expect(result.structuralDrift).toHaveLength(1)
    expect(result.structuralDrift[0].id).toBe("s")
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("translatableDrift still detected when old tree is deserialized", () => {
    const beforeMd = `## Section {#s}\n\nOld prose.\n\n## Next {#next}\n\nOther.`
    const afterMd = `## Section {#s}\n\nNew prose.\n\n## Next {#next}\n\nOther.`

    const beforeTree = parseMarkdown(beforeMd, ELEMENT_CFG)
    const manifest = serialize(beforeTree, "test.md")
    const oldTree = deserialize(manifest)
    computeHashes(oldTree)

    const newTree = parseMarkdown(afterMd, ELEMENT_CFG)
    const result = diff(oldTree, newTree)

    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("s")
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("inertDrift still detected when old tree is deserialized", () => {
    const beforeMd = `## Section {#s}\n\nRead [about it](/old-url/) here.\n\n## Next {#next}\n\nOther.`
    const afterMd = `## Section {#s}\n\nRead [about it](/new-url/) here.\n\n## Next {#next}\n\nOther.`

    const beforeTree = parseMarkdown(beforeMd, ELEMENT_CFG)
    const manifest = serialize(beforeTree, "test.md")
    const oldTree = deserialize(manifest)
    computeHashes(oldTree)

    const newTree = parseMarkdown(afterMd, ELEMENT_CFG)
    const result = diff(oldTree, newTree)

    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("s")
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("prose removal detected as translatableDrift when old tree is deserialized", () => {
    const beforeMd = `## Section {#s}\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Next {#next}\n\nOther.`
    const afterMd = `## Section {#s}\n\nFirst paragraph.\n\n## Next {#next}\n\nOther.`

    const beforeTree = parseMarkdown(beforeMd, ELEMENT_CFG)
    const manifest = serialize(beforeTree, "test.md")
    const oldTree = deserialize(manifest)
    computeHashes(oldTree)

    const newTree = parseMarkdown(afterMd, ELEMENT_CFG)
    const result = diff(oldTree, newTree)

    // Prose removed -> translatableDrift (not structural)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("s")
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("heading ID rename does not trigger translatableDrift on parent", () => {
    // Subsection renamed {#old-name} -> {#new-name}, content identical
    const beforeMd = [
      "## Parent {#parent}",
      "",
      "### Old Name {#old-name}",
      "",
      "Content stays the same.",
      "",
      "## Next {#next}",
      "",
      "Other.",
    ].join("\n")
    const afterMd = [
      "## Parent {#parent}",
      "",
      "### New Name {#new-name}",
      "",
      "Content stays the same.",
      "",
      "## Next {#next}",
      "",
      "Other.",
    ].join("\n")

    const beforeTree = parseMarkdown(beforeMd, ELEMENT_CFG)
    const manifest = serialize(beforeTree, "test.md")
    const oldTree = deserialize(manifest)
    computeHashes(oldTree)

    const newTree = parseMarkdown(afterMd, ELEMENT_CFG)
    const result = diff(oldTree, newTree)

    // Subsection renamed but content identical -> parent is unchanged
    // (heading ID is excluded from contentHash, child prose is the same)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.structuralDrift).toHaveLength(0)
    expect(result.unchanged.some((e) => e.id === "parent")).toBe(true)
  })
})

describe("getContainingSection", () => {
  it("maps a deep node path to its section ID", () => {
    const tree = parseMarkdown(
      [
        "## My Section {#my-section}",
        "",
        "Text with a [link](https://example.com).",
      ].join("\n"),
      ELEMENT_CFG
    )
    const section = getContainingSection(tree, "my-section/link:1")
    expect(section).toBe("my-section")
  })

  it("maps a component child path to its section", () => {
    const tree = parseMarkdown(
      [
        "## Section {#s}",
        "",
        '<Alert variant="info">',
        "",
        "Inner [link](https://example.com)",
        "",
        "</Alert>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const section = getContainingSection(tree, "s/component:1/link:0")
    expect(section).toBe("s")
  })

  it("maps a nested section to itself", () => {
    const tree = parseMarkdown(
      [
        "## Parent {#parent}",
        "",
        "### Child {#child}",
        "",
        "Content.",
      ].join("\n"),
      ELEMENT_CFG
    )
    const section = getContainingSection(tree, "parent/child/prose:1")
    expect(section).toBe("child")
  })

  it("returns undefined for root-level paths", () => {
    const tree = parseMarkdown(
      "---\ntitle: Test\nlang: en\n---\n\n## S {#s}\n\nContent.",
      ELEMENT_CFG
    )
    const section = getContainingSection(tree, "frontmatter:title")
    expect(section).toBeUndefined()
  })

  it("returns undefined for non-existent path", () => {
    const tree = parseMarkdown(
      `## Section {#s}\n\nContent.`,
      ELEMENT_CFG
    )
    const section = getContainingSection(tree, "nonexistent/path")
    expect(section).toBeUndefined()
  })
})
