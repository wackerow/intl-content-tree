import { describe, it, expect } from "vitest"
import { parseMarkdown } from "../../src/parsers/markdown.js"
import { diff } from "../../src/core/diff.js"
import { extractChanges } from "../../src/core/extract.js"
import { hasChanges, serialize, validate } from "../../src/core/tree.js"

// The shape the localization pipeline uses: element depth, with the
// translatable frontmatter fields named explicitly.
const PIPELINE_CFG = {
  depth: "element" as const,
  translatableAttributes: [
    "title",
    "description",
    "alt",
    "label",
    "summaryPoints",
  ],
}

const VIDEO_PAGE = [
  "---",
  'title: "What is Ethereum?"',
  "description: A short introduction to the network",
  "lang: en",
  "template: video",
  "youtubeId: dQw4w9WgXcQ",
  "published: 2026-06-12",
  "topic:",
  '  - "Ethereum basics"',
  '  - "Wallets"',
  '  - "Staking"',
  '  - "Scaling"',
  "---",
  "",
  "## About this video {#about-this-video}",
  "",
  "A walkthrough of the basics.",
].join("\n")

const TUTORIAL = [
  "---",
  'title: "Deploy your first contract"',
  "description: A hands-on tutorial",
  'author: "Ada Lovelace"',
  'tags: ["solidity", "remix", "smart contracts"]',
  "skill: beginner",
  "lang: en",
  "published: 2026-06-12",
  "---",
  "",
  "## Set up {#set-up}",
  "",
  "Install the toolchain first.",
].join("\n")

const SUMMARY_PAGE = [
  "---",
  'title: "Proof of stake"',
  "description: How Ethereum reaches consensus",
  "lang: en",
  "summaryPoints:",
  '  - "Validators stake ETH to propose blocks"',
  '  - "Misbehaving validators lose part of their stake"',
  "---",
  "",
  "## Consensus {#consensus}",
  "",
  "Validators take turns proposing blocks.",
].join("\n")

describe("frontmatter drift in pipeline-shaped content", () => {
  it("video page: topic shrinking from 4 items to 1 moves the root hash", () => {
    const before = parseMarkdown(VIDEO_PAGE, PIPELINE_CFG)
    const shrunk = VIDEO_PAGE.replace(
      [
        "topic:",
        '  - "Ethereum basics"',
        '  - "Wallets"',
        '  - "Staking"',
        '  - "Scaling"',
      ].join("\n"),
      ["topic:", '  - "Ethereum basics"'].join("\n")
    )
    const after = parseMarkdown(shrunk, PIPELINE_CFG)

    const manifest = serialize(before, "videos/what-is-ethereum.md")
    expect(hasChanges(after, manifest)).toBe(true)

    const result = diff(before, after)
    expect(result.structuralDrift.map((e) => e.id)).toEqual([
      "frontmatter:topic",
    ])
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.unchanged.some((e) => e.id === "about-this-video")).toBe(true)

    const changes = extractChanges(before, after).changes
    expect(changes.map((c) => [c.action, c.path, c.oldValue])).toEqual([
      ["remove", "frontmatter:topic/1", "Wallets"],
      ["remove", "frontmatter:topic/2", "Staking"],
      ["remove", "frontmatter:topic/3", "Scaling"],
    ])
  })

  it("tutorial: flow-style tags decompose into item nodes", () => {
    const tree = parseMarkdown(TUTORIAL, PIPELINE_CFG)
    const tags = tree.children.find((c) => c.id === "frontmatter:tags")!
    expect(tags.nodeType).toBe("section")
    expect(tags.children.map((c) => c.value)).toEqual([
      "solidity",
      "remix",
      "smart contracts",
    ])
    for (const item of tags.children) {
      expect(item.contentType).toBe("inert")
    }

    const retagged = TUTORIAL.replace(
      'tags: ["solidity", "remix", "smart contracts"]',
      'tags: ["solidity", "hardhat", "smart contracts"]'
    )
    const after = parseMarkdown(retagged, PIPELINE_CFG)
    expect(hasChanges(after, serialize(tree, "tutorials/deploy.md"))).toBe(true)

    const result = diff(tree, after)
    expect(result.inertDrift.map((e) => e.id)).toEqual(["frontmatter:tags"])
    expect(result.translatableDrift).toHaveLength(0)

    // Reformatting the same tags as a block sequence is not a change
    const reformatted = TUTORIAL.replace(
      'tags: ["solidity", "remix", "smart contracts"]',
      'tags:\n  - solidity\n  - remix\n  - "smart contracts"'
    )
    expect(
      hasChanges(
        parseMarkdown(reformatted, PIPELINE_CFG),
        serialize(tree, "tutorials/deploy.md")
      )
    ).toBe(false)
  })

  it("summaryPoints text change -> translatableDrift with the exact edit", () => {
    const before = parseMarkdown(SUMMARY_PAGE, PIPELINE_CFG)
    const after = parseMarkdown(
      SUMMARY_PAGE.replace(
        '"Misbehaving validators lose part of their stake"',
        '"Validators that misbehave are slashed"'
      ),
      PIPELINE_CFG
    )

    expect(hasChanges(after, serialize(before, "roadmap/pos.md"))).toBe(true)

    const result = diff(before, after)
    expect(result.translatableDrift.map((e) => e.id)).toEqual([
      "frontmatter:summaryPoints",
    ])
    expect(result.unchanged.some((e) => e.id === "consensus")).toBe(true)

    const changes = extractChanges(before, after).changes
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      action: "update",
      path: "frontmatter:summaryPoints/1",
      contentType: "translatable",
      key: "summaryPoints",
      oldValue: "Misbehaving validators lose part of their stake",
      newValue: "Validators that misbehave are slashed",
    })
  })

  it("only heading sections count toward ID coverage", () => {
    const result = validate(parseMarkdown(VIDEO_PAGE, PIPELINE_CFG))
    expect(result.totalSections).toBe(1)
    expect(result.stableIds).toBe(1)
    expect(result.coverage).toBe(100)
  })

  it("identical input produces no drift", () => {
    for (const page of [VIDEO_PAGE, TUTORIAL, SUMMARY_PAGE]) {
      const result = diff(
        parseMarkdown(page, PIPELINE_CFG),
        parseMarkdown(page, PIPELINE_CFG)
      )
      expect(result.translatableDrift).toHaveLength(0)
      expect(result.inertDrift).toHaveLength(0)
      expect(result.structuralDrift).toHaveLength(0)
      expect(result.added).toHaveLength(0)
      expect(result.removed).toHaveLength(0)
    }
  })
})
