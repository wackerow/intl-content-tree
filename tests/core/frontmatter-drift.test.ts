import { describe, it, expect } from "vitest"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { diff, getContainingSection } from "../../src/core/diff.js"
import { validate } from "../../src/core/tree.js"

const CFG = {
  depth: "element" as const,
  translatableAttributes: ["title", "description", "summaryPoints"],
}

const mk = (fm: string) => `---\n${fm}\n---\n\n## Title {#title}\n\nBody.\n`
const driftOf = (before: string, after: string) =>
  diff(parseMarkdown(mk(before), CFG), parseMarkdown(mk(after), CFG))

describe("frontmatter drift classification", () => {
  it("translatable sequence item edited -> translatableDrift", () => {
    const result = driftOf(
      'summaryPoints:\n  - "Point A"\n  - "Point B"',
      'summaryPoints:\n  - "Point A"\n  - "Point B rewritten"'
    )
    expect(result.translatableDrift.map((e) => e.id)).toEqual([
      "frontmatter:summaryPoints",
    ])
    expect(result.translatableDrift[0].path).toBe("frontmatter:summaryPoints")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  it("inert sequence item edited -> inertDrift", () => {
    const result = driftOf(
      'topic:\n  - "defi"\n  - "staking"',
      'topic:\n  - "defi"\n  - "solo staking"'
    )
    expect(result.inertDrift.map((e) => e.id)).toEqual(["frontmatter:topic"])
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
  })

  it("translatable sequence item added -> translatableDrift", () => {
    const result = driftOf(
      'summaryPoints:\n  - "Point A"',
      'summaryPoints:\n  - "Point A"\n  - "Point B"'
    )
    expect(result.translatableDrift.map((e) => e.id)).toEqual([
      "frontmatter:summaryPoints",
    ])
  })

  it("translatable sequence item removed -> translatableDrift", () => {
    const result = driftOf(
      'summaryPoints:\n  - "Point A"\n  - "Point B"',
      'summaryPoints:\n  - "Point A"'
    )
    expect(result.translatableDrift.map((e) => e.id)).toEqual([
      "frontmatter:summaryPoints",
    ])
  })

  // Same rule the JSON parser's arrays follow: the bucket depends on whether
  // the multiset of translatable leaf hashes changed, not on the item count.
  it("inert sequence item added -> structuralDrift", () => {
    const result = driftOf('topic:\n  - "defi"', 'topic:\n  - "defi"\n  - "nft"')
    expect(result.structuralDrift.map((e) => e.id)).toEqual([
      "frontmatter:topic",
    ])
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("inert sequence items removed -> structuralDrift", () => {
    const result = driftOf(
      'topic:\n  - "defi"\n  - "nft"\n  - "dao"\n  - "zk"',
      'topic:\n  - "defi"'
    )
    expect(result.structuralDrift.map((e) => e.id)).toEqual([
      "frontmatter:topic",
    ])
  })

  it("translatable sequence reordered -> structuralDrift (no new text)", () => {
    const result = driftOf(
      'summaryPoints:\n  - "Point A"\n  - "Point B"',
      'summaryPoints:\n  - "Point B"\n  - "Point A"'
    )
    expect(result.structuralDrift.map((e) => e.id)).toEqual([
      "frontmatter:summaryPoints",
    ])
    expect(result.translatableDrift).toHaveLength(0)
  })

  it("inert sequence reordered -> inertDrift", () => {
    const result = driftOf(
      'topic:\n  - "defi"\n  - "nft"',
      'topic:\n  - "nft"\n  - "defi"'
    )
    expect(result.inertDrift.map((e) => e.id)).toEqual(["frontmatter:topic"])
  })

  it("flow -> block reformat with identical items -> unchanged", () => {
    const result = driftOf('tags: ["solidity", "vyper"]', "tags:\n  - solidity\n  - vyper")
    expect(result.unchanged.map((e) => e.id).sort()).toEqual([
      "frontmatter:tags",
      "title",
    ])
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.inertDrift).toHaveLength(0)
    expect(result.structuralDrift).toHaveLength(0)
  })

  it("mapping subkey edit is classified by the subkey", () => {
    const translatable = driftOf(
      "author:\n  title: Researcher\n  name: Ada",
      "author:\n  title: Protocol researcher\n  name: Ada"
    )
    expect(translatable.translatableDrift.map((e) => e.id)).toEqual([
      "frontmatter:author",
    ])

    const inert = driftOf(
      "author:\n  title: Researcher\n  name: Ada",
      "author:\n  title: Researcher\n  name: Grace"
    )
    expect(inert.inertDrift.map((e) => e.id)).toEqual(["frontmatter:author"])
  })

  it("scalar fields classify exactly as before", () => {
    const translatable = driftOf("title: Old", "title: New")
    expect(translatable.translatableDrift.map((e) => e.id)).toEqual([
      "frontmatter:title",
    ])

    const inert = driftOf("lang: en", "lang: fr")
    expect(inert.inertDrift.map((e) => e.id)).toEqual(["frontmatter:lang"])
  })

  it("an untouched frontmatter sequence stays unchanged", () => {
    const fm = 'summaryPoints:\n  - "Point A"\ntopic:\n  - "defi"'
    const result = driftOf(fm, fm)
    expect(result.unchanged.map((e) => e.id).sort()).toEqual([
      "frontmatter:summaryPoints",
      "frontmatter:topic",
      "title",
    ])
  })
})

describe("frontmatter sections are not content sections", () => {
  const tree = parseMarkdown(
    mk('summaryPoints:\n  - "Point A"\ntopic:\n  - "defi"\nauthor:\n  name: Ada'),
    CFG
  )

  it("validate() does not count them", () => {
    const result = validate(tree)
    expect(result.totalSections).toBe(1)
    expect(result.stableIds).toBe(1)
    expect(result.autoSlugs).toBe(0)
    expect(result.coverage).toBe(100)
    expect(result.duplicateIds).toHaveLength(0)
  })

  it("getContainingSection() never returns one", () => {
    expect(getContainingSection(tree, "frontmatter:summaryPoints")).toBeUndefined()
    expect(getContainingSection(tree, "frontmatter:summaryPoints/0")).toBeUndefined()
    expect(getContainingSection(tree, "title/prose:1")).toBe("title")
  })
})
