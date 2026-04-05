import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { diff } from "../../src/core/diff.js"
import { serialize, deserialize, computeHashes } from "../../src/core/tree.js"

function readFixture(name: string): string {
  return readFileSync(
    join(import.meta.dirname, "../fixtures/markdown", name),
    "utf-8"
  )
}

const ELEMENT_CFG = { depth: "element" as const }

describe("drift detection integration", () => {
  it("case 1: URL change in regular markdown link -> inertDrift", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\nRead the [documentation](https://example.com/docs) for details.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\nRead the [documentation](https://example.com/new-docs) for details.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 2: URL change inside component children -> inertDrift", () => {
    const before = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        '<Alert variant="info">',
        "",
        "Visit [Our Site](https://example.com/) for more info",
        "",
        "</Alert>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        '<Alert variant="info">',
        "",
        "Visit [Our Site](https://example.com/new) for more info",
        "",
        "</Alert>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 3: URL change in bare HTML <a> tag -> inertDrift", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\nCheck the <a href="https://example.com/faq">FAQ page</a> for answers.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\nCheck the <a href="https://example.com/new-faq">FAQ page</a> for answers.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 4: image src change -> inertDrift", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\n![Diagram](/images/diagram-v1.png)`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\n![Diagram](/images/diagram-v2.png)`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 5: inline code change -> inertDrift", () => {
    const before = parseMarkdown(
      "## Section {#my-section}\n\nUse the `oldFunction()` method to connect.",
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      "## Section {#my-section}\n\nUse the `newFunction()` method to connect.",
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 6: link display text change (URL same) -> translatableDrift", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\nRead the [old label](https://example.com/) for details.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\nRead the [new label](https://example.com/) for details.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("my-section")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
    expect(result.translatableDrift[0].anchorHashChanged).toBe(false)
  })

  it("case 7: both URL and display text change -> translatableDrift", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\nRead the [old label](https://example.com/old) for details.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\nRead the [new label](https://example.com/new) for details.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
    expect(result.translatableDrift[0].anchorHashChanged).toBe(true)
  })

  it("case 8: frontmatter inert field change (image) -> inertDrift", () => {
    const base = [
      "---",
      "title: My Page",
      "description: A test page",
      "image: /images/old.png",
      "lang: en",
      "---",
      "",
      "## Section {#my-section}",
      "",
      "Content here.",
    ].join("\n")
    const modified = base.replace("image: /images/old.png", "image: /images/new.png")

    const before = parseMarkdown(base, ELEMENT_CFG)
    const after = parseMarkdown(modified, ELEMENT_CFG)
    const result = diff(before, after)

    // Only frontmatter:image should change
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("frontmatter:image")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)

    // Section and other frontmatter unchanged
    expect(result.unchanged.some((e) => e.id === "my-section")).toBe(true)
    expect(result.unchanged.some((e) => e.id === "frontmatter:title")).toBe(true)
  })

  it("case 9: frontmatter translatable field change (title) -> translatableDrift", () => {
    const base = [
      "---",
      "title: My Page",
      "description: A test page",
      "image: /images/old.png",
      "lang: en",
      "---",
      "",
      "## Section {#my-section}",
      "",
      "Content here.",
    ].join("\n")
    const modified = base.replace("title: My Page", "title: New Title")

    const before = parseMarkdown(base, ELEMENT_CFG)
    const after = parseMarkdown(modified, ELEMENT_CFG)
    const result = diff(before, after)

    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("frontmatter:title")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  it("case 10: multiple links, change only one URL", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\nSee [first link](https://example.com/a) and [second link](https://example.com/b) for details.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\nSee [first link](https://example.com/new-a) and [second link](https://example.com/b) for details.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)

    // Section level: inertDrift (anchor changed, content unchanged)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)

    // Verify at the node level: link:0 changed, link:1 unchanged
    const section = after.children.find((c) => c.id === "my-section")!
    const links = section.children.filter((c) => c.elementType === "link")
    expect(links).toHaveLength(2)

    const beforeSection = before.children.find((c) => c.id === "my-section")!
    const beforeLinks = beforeSection.children.filter((c) => c.elementType === "link")

    // First link's anchorHash changed
    expect(links[0].anchorHash).not.toBe(beforeLinks[0].anchorHash)
    // Second link's anchorHash unchanged
    expect(links[1].anchorHash).toBe(beforeLinks[1].anchorHash)
  })

  it("case 11: component translatable vs inert attributes", () => {
    const before = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        '<ExpandableCard title="What is staking?" eventCategory="/staking">',
        "",
        "Staking is important.",
        "",
        "</ExpandableCard>",
      ].join("\n"),
      ELEMENT_CFG
    )

    // Verify attribute nodes exist on the component
    const section = before.children.find((c) => c.id === "my-section")!
    const component = section.children.find((c) => c.elementType === "component")!
    const titleAttr = component.children.find((c) => c.id === "attr:title")
    const eventAttr = component.children.find((c) => c.id === "attr:eventCategory")
    expect(titleAttr).toBeDefined()
    expect(titleAttr!.contentType).toBe("translatable")
    expect(titleAttr!.value).toBe("What is staking?")
    expect(eventAttr).toBeDefined()
    expect(eventAttr!.contentType).toBe("inert")
    expect(eventAttr!.value).toBe("/staking")

    // Change only eventCategory -> inertDrift
    const afterInert = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        '<ExpandableCard title="What is staking?" eventCategory="/staking/new">',
        "",
        "Staking is important.",
        "",
        "</ExpandableCard>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const inertResult = diff(before, afterInert)
    expect(inertResult.inertDrift).toHaveLength(1)
    expect(inertResult.inertDrift[0].id).toBe("my-section")
    expect(inertResult.inertDrift[0].anchorHashChanged).toBe(true)
    expect(inertResult.inertDrift[0].contentHashChanged).toBe(false)

    // Change only title -> translatableDrift
    const afterTitle = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        '<ExpandableCard title="What is mining?" eventCategory="/staking">',
        "",
        "Staking is important.",
        "",
        "</ExpandableCard>",
      ].join("\n"),
      ELEMENT_CFG
    )
    const titleResult = diff(before, afterTitle)
    expect(titleResult.translatableDrift).toHaveLength(1)
    expect(titleResult.translatableDrift[0].id).toBe("my-section")
    expect(titleResult.translatableDrift[0].contentHashChanged).toBe(true)
  })

  // --- End-to-end parse-diff cases (added by Relay) ---

  it("case 12: no change -> all unchanged", () => {
    const md = [
      "---",
      "title: My Page",
      "lang: en",
      "---",
      "",
      "## First {#first}",
      "",
      "Some content with a [link](https://example.com).",
      "",
      "## Second {#second}",
      "",
      "More content.",
    ].join("\n")
    const tree1 = parseMarkdown(md, ELEMENT_CFG)
    const tree2 = parseMarkdown(md, ELEMENT_CFG)
    const result = diff(tree1, tree2)
    // frontmatter:title, frontmatter:lang, first, second
    expect(result.unchanged).toHaveLength(4)
    expect(result.inertDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.renamed).toHaveLength(0)
    expect(result.reordered).toHaveLength(0)
  })

  it("case 13: heading label change (same ID) -> labelHashChanged", () => {
    const before = parseMarkdown(
      `## Old Heading Text {#my-section}\n\nContent stays the same.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## New Heading Text {#my-section}\n\nContent stays the same.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Label-only change lands in unchanged, NOT translatableDrift
    expect(result.translatableDrift).toHaveLength(0)
    const entry = result.unchanged.find((e) => e.id === "my-section")
    expect(entry).toBeDefined()
    expect(entry!.labelHashChanged).toBe(true)
    expect(entry!.contentHashChanged).toBe(false)
    expect(entry!.anchorHashChanged).toBe(false)
  })

  it("case 14: section added -> added", () => {
    const before = parseMarkdown(
      `## First {#first}\n\nContent.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## First {#first}\n\nContent.\n\n## New Section {#new-section}\n\nNew content.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.added).toHaveLength(1)
    expect(result.added[0].id).toBe("new-section")
    expect(result.unchanged.some((e) => e.id === "first")).toBe(true)
  })

  it("case 15: section removed -> removed", () => {
    const before = parseMarkdown(
      `## First {#first}\n\nContent.\n\n## Second {#second}\n\nMore content.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## First {#first}\n\nContent.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].id).toBe("second")
    expect(result.unchanged.some((e) => e.id === "first")).toBe(true)
  })

  it("case 16: sections reordered -> reordered", () => {
    const before = parseMarkdown(
      `## Alpha {#alpha}\n\nFirst.\n\n## Beta {#beta}\n\nSecond.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Beta {#beta}\n\nSecond.\n\n## Alpha {#alpha}\n\nFirst.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.reordered).toHaveLength(2)
    const alpha = result.reordered.find((e) => e.id === "alpha")
    expect(alpha).toBeDefined()
    expect(alpha!.oldIndex).toBe(0)
    expect(alpha!.newIndex).toBe(1)
  })

  it("case 17: prose edit -> translatableDrift", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\nOriginal paragraph text here.`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\nModified paragraph text here.`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("my-section")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  // --- Edge cases (Chisel + Relay) ---

  it("case 18: double-nested components with link change -> inertDrift", () => {
    const md = (href: string) =>
      [
        "## Section {#my-section}",
        "",
        '<Alert variant="info">',
        "",
        "<Card>",
        "",
        `Visit [Our Site](${href}) for more info`,
        "",
        "</Card>",
        "",
        "</Alert>",
      ].join("\n")
    const before = parseMarkdown(md("https://example.com/"), ELEMENT_CFG)
    const after = parseMarkdown(md("https://example.com/new"), ELEMENT_CFG)
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 19: self-closing inert component -> inertDrift on attr change", () => {
    const before = parseMarkdown(
      `## Section {#my-section}\n\n<Demo id="abc123" />`,
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      `## Section {#my-section}\n\n<Demo id="def456" />`,
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 20: empty section (heading only) -> unchanged", () => {
    const md = [
      "## First {#first}",
      "",
      "## Second {#second}",
      "",
      "Content only in second.",
    ].join("\n")
    const tree1 = parseMarkdown(md, ELEMENT_CFG)
    const tree2 = parseMarkdown(md, ELEMENT_CFG)
    const result = diff(tree1, tree2)
    expect(result.unchanged.some((e) => e.id === "first")).toBe(true)
    expect(result.unchanged.some((e) => e.id === "second")).toBe(true)
    expect(result.inertDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("case 21: serialize/deserialize round-trip with component attrs", () => {
    const md = [
      "---",
      "title: Test Page",
      "lang: en",
      "---",
      "",
      "## Section {#my-section}",
      "",
      '<ExpandableCard title="FAQ" eventCategory="/faq">',
      "",
      "Content with a [link](https://example.com).",
      "",
      "</ExpandableCard>",
      "",
      '<Demo id="abc123" />',
    ].join("\n")
    const original = parseMarkdown(md, ELEMENT_CFG)
    const manifest = serialize(original, "test.md")
    const restored = deserialize(manifest)
    // Re-hash the restored tree so we can diff
    computeHashes(restored)
    const result = diff(original, restored)
    // Everything should be unchanged after round-trip
    expect(result.inertDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.unchanged.length).toBeGreaterThan(0)
  })

  it("case 22: prose fence (md) change -> translatableDrift", () => {
    const before = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        "```md",
        "Old prose inside fence",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        "```md",
        "New prose inside fence",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("my-section")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  it("case 23: code body change (non-prose fence) -> inertDrift", () => {
    const before = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        "```solidity",
        "uint256 x = 1;",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        "```solidity",
        "uint256 x = 2;",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("my-section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 24: code comment change at element depth -> translatableDrift", () => {
    const before = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        "```solidity",
        "// Old comment",
        "uint256 x = 1;",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const after = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        "```solidity",
        "// New comment",
        "uint256 x = 1;",
        "```",
      ].join("\n"),
      ELEMENT_CFG
    )
    const result = diff(before, after)
    // Comment is translatable, code body is inert
    // The section has both contentHash change (comment) and anchorHash change (code body includes comment line too)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("my-section")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  it("case 25: markdown in attribute value treated as plain string", () => {
    const before = parseMarkdown(
      [
        "## Section {#my-section}",
        "",
        '<ExpandableCard title="Learn about [staking](/staking)" contentPreview="Preview">',
        "",
        "Content here.",
        "",
        "</ExpandableCard>",
      ].join("\n"),
      ELEMENT_CFG
    )
    // The title attr value should be the raw string, not parsed as a link
    const section = before.children.find((c) => c.id === "my-section")!
    const component = section.children.find((c) => c.elementType === "component")!
    const titleAttr = component.children.find((c) => c.id === "attr:title")
    expect(titleAttr).toBeDefined()
    expect(titleAttr!.value).toBe("Learn about [staking](/staking)")
    expect(titleAttr!.contentType).toBe("translatable")
  })

  // --- Real-world fixture test ---

  it("case 26: real-world page -> deterministic, no false drift", () => {
    const md = readFixture("real-world.md")
    const tree1 = parseMarkdown(md, ELEMENT_CFG)
    const tree2 = parseMarkdown(md, ELEMENT_CFG)
    const result = diff(tree1, tree2)

    // Deterministic: identical input -> all unchanged, zero drift
    expect(result.inertDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.renamed).toHaveLength(0)
    expect(result.reordered).toHaveLength(0)

    // Verify structure: frontmatter + 4 top-level sections
    const sections = tree1.children.filter((c) => c.nodeType === "section")
    expect(sections.map((s) => s.id)).toEqual([
      "what-is-free-software",
      "choosing-a-license",
      "community",
      "further-reading",
    ])

    // Verify nested sections
    const choosingLicense = sections[1]
    const nestedSections = choosingLicense.children.filter(
      (c) => c.nodeType === "section"
    )
    expect(nestedSections.map((s) => s.id)).toEqual(["copyleft", "permissive"])

    // Verify frontmatter fields
    const fmFields = tree1.children.filter((c) =>
      c.id.startsWith("frontmatter:")
    )
    expect(fmFields.length).toBe(4) // title, description, image, lang
    const fmImage = fmFields.find((f) => f.id === "frontmatter:image")!
    expect(fmImage.contentType).toBe("inert")
  })

  it("case 27: real-world page -> URL mutation detected as inertDrift", () => {
    const md = readFixture("real-world.md")
    const mutated = md.replace(
      "https://www.fsf.org/",
      "https://www.fsf.org/new-page"
    )
    const before = parseMarkdown(md, ELEMENT_CFG)
    const after = parseMarkdown(mutated, ELEMENT_CFG)
    const result = diff(before, after)

    // Only the section containing the FSF link should drift
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("what-is-free-software")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("case 28: real-world page -> prose mutation detected as translatableDrift", () => {
    const md = readFixture("real-world.md")
    const mutated = md.replace(
      "Free software respects users' freedom.",
      "Free software protects users' autonomy."
    )
    const before = parseMarkdown(md, ELEMENT_CFG)
    const after = parseMarkdown(mutated, ELEMENT_CFG)
    const result = diff(before, after)

    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("what-is-free-software")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  it("case 29: real-world page -> serialize round-trip preserves all hashes", () => {
    const md = readFixture("real-world.md")
    const original = parseMarkdown(md, ELEMENT_CFG)
    const manifest = serialize(original, "real-world.md")
    const restored = deserialize(manifest)
    computeHashes(restored)
    const result = diff(original, restored)

    expect(result.inertDrift).toHaveLength(0)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.unchanged.length).toBeGreaterThan(0)
  })
})
