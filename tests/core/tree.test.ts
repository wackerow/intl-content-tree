import { describe, it, expect } from "vitest"
import {
  createNode,
  computeHashes,
  walk,
  getNodeByPath,
  getInertValue,
  serialize,
  deserialize,
  hasChanges,
  validate,
} from "../../src/core/tree.js"
import { hash } from "../../src/core/hash.js"

function makeSimpleTree() {
  return createNode({
    id: "root",
    nodeType: "root",
    contentType: "mixed",
    elementType: "root",
    children: [
      createNode({
        id: "section-a",
        nodeType: "section",
        contentType: "mixed",
        elementType: "section",
        children: [
          createNode({
            id: "prose:0",
            nodeType: "element",
            contentType: "translatable",
            elementType: "prose",
            value: "Hello world",
          }),
          createNode({
            id: "link:0",
            nodeType: "element",
            contentType: "inert",
            elementType: "link",
            value: "https://example.com",
          }),
        ],
      }),
      createNode({
        id: "section-b",
        nodeType: "section",
        contentType: "mixed",
        elementType: "section",
        children: [
          createNode({
            id: "prose:0",
            nodeType: "element",
            contentType: "translatable",
            elementType: "prose",
            value: "Second section",
          }),
        ],
      }),
    ],
  })
}

describe("computeHashes", () => {
  it("computes hashes for leaf translatable nodes", () => {
    const node = createNode({
      id: "test",
      nodeType: "element",
      contentType: "translatable",
      elementType: "prose",
      value: "hello",
    })
    const hashed = computeHashes(node)
    expect(hashed.contentHash).toBe(hash("hello"))
    expect(hashed.anchorHash).toBe(hash(""))
  })

  it("computes hashes for leaf inert nodes", () => {
    const node = createNode({
      id: "test",
      nodeType: "element",
      contentType: "inert",
      elementType: "code-body",
      value: "const x = 1",
    })
    const hashed = computeHashes(node)
    expect(hashed.contentHash).toBe(hash(""))
    expect(hashed.anchorHash).toBe(hash("const x = 1"))
  })

  it("computes merkle hashes for branch nodes", () => {
    const tree = makeSimpleTree()
    const hashed = computeHashes(tree)
    expect(hashed.contentHash).toHaveLength(12)
    expect(hashed.anchorHash).toHaveLength(12)

    // Branch hash should be a hash of children's hashes
    expect(hashed.contentHash).not.toBe(hash(""))
  })

  it("is deterministic", () => {
    const tree1 = computeHashes(makeSimpleTree())
    const tree2 = computeHashes(makeSimpleTree())
    expect(tree1.contentHash).toBe(tree2.contentHash)
    expect(tree1.anchorHash).toBe(tree2.anchorHash)
  })

  it("changes when content changes", () => {
    const tree1 = computeHashes(makeSimpleTree())

    const modified = makeSimpleTree()
    modified.children[0].children[0].value = "Modified content"
    const tree2 = computeHashes(modified)

    expect(tree1.contentHash).not.toBe(tree2.contentHash)
  })
})

describe("walk", () => {
  it("yields all nodes depth-first", () => {
    const tree = computeHashes(makeSimpleTree())
    const ids = [...walk(tree)].map((n) => n.id)
    expect(ids).toEqual([
      "root",
      "section-a",
      "prose:0",
      "link:0",
      "section-b",
      "prose:0",
    ])
  })
})

describe("getNodeByPath", () => {
  it("finds a direct child", () => {
    const tree = computeHashes(makeSimpleTree())
    const node = getNodeByPath(tree, "section-a")
    expect(node).toBeDefined()
    expect(node!.id).toBe("section-a")
  })

  it("finds a nested node", () => {
    const tree = computeHashes(makeSimpleTree())
    const node = getNodeByPath(tree, "section-a/prose:0")
    expect(node).toBeDefined()
    expect(node!.value).toBe("Hello world")
  })

  it("returns undefined for non-existent path", () => {
    const tree = computeHashes(makeSimpleTree())
    expect(getNodeByPath(tree, "nonexistent")).toBeUndefined()
  })
})

describe("serialize / deserialize", () => {
  it("round-trips without losing structure", () => {
    const tree = computeHashes(makeSimpleTree())
    const manifest = serialize(tree, "test.md")
    const restored = deserialize(manifest)

    expect(restored.children).toHaveLength(2)
    expect(restored.children[0].id).toBe("section-a")
    expect(restored.children[0].children).toHaveLength(2)
    expect(restored.children[1].id).toBe("section-b")
  })

  it("preserves child order", () => {
    const tree = computeHashes(makeSimpleTree())
    const manifest = serialize(tree)
    expect(manifest.tree.childrenOrder).toEqual(["section-a", "section-b"])
  })

  it("preserves hashes", () => {
    const tree = computeHashes(makeSimpleTree())
    const manifest = serialize(tree)
    const restored = deserialize(manifest)

    expect(restored.contentHash).toBe(tree.contentHash)
    expect(restored.anchorHash).toBe(tree.anchorHash)
    expect(restored.children[0].contentHash).toBe(
      tree.children[0].contentHash
    )
  })

  it("manifest has correct metadata", () => {
    const tree = computeHashes(makeSimpleTree())
    const manifest = serialize(tree, "test.md")
    expect(manifest.version).toBe(1)
    expect(manifest.sourceFile).toBe("test.md")
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(manifest.rootHash).toHaveLength(12)
  })
})

describe("hasChanges", () => {
  it("returns false for identical tree and manifest", () => {
    const tree = computeHashes(makeSimpleTree())
    const manifest = serialize(tree)
    expect(hasChanges(tree, manifest)).toBe(false)
  })

  it("returns true when tree differs from manifest", () => {
    const tree = computeHashes(makeSimpleTree())
    const manifest = serialize(tree)

    const modified = makeSimpleTree()
    modified.children[0].children[0].value = "Changed"
    const modifiedTree = computeHashes(modified)

    expect(hasChanges(modifiedTree, manifest)).toBe(true)
  })
})

describe("labelHash", () => {
  function makeTreeWithLabels() {
    return createNode({
      id: "root",
      nodeType: "root",
      contentType: "mixed",
      elementType: "root",
      children: [
        createNode({
          id: "my-section",
          nodeType: "section",
          contentType: "mixed",
          elementType: "section",
          children: [
            createNode({
              id: "_label",
              nodeType: "element",
              contentType: "translatable",
              elementType: "heading",
              value: "My Heading",
            }),
            createNode({
              id: "prose:0",
              nodeType: "element",
              contentType: "translatable",
              elementType: "prose",
              value: "Body content here",
            }),
          ],
        }),
      ],
    })
  }

  it("computes labelHash for sections with _label child", () => {
    const tree = computeHashes(makeTreeWithLabels())
    const section = tree.children[0]
    expect(section.labelHash).toBeDefined()
    expect(section.labelHash).toHaveLength(12)
  })

  it("excludes _label from contentHash", () => {
    const withLabel = computeHashes(makeTreeWithLabels())

    // Build same tree but with different label
    const differentLabel = makeTreeWithLabels()
    differentLabel.children[0].children[0].value = "Different Heading"
    const hashed = computeHashes(differentLabel)

    // contentHash should be SAME (body didn't change)
    expect(withLabel.children[0].contentHash).toBe(
      hashed.children[0].contentHash
    )
    // labelHash should DIFFER
    expect(withLabel.children[0].labelHash).not.toBe(
      hashed.children[0].labelHash
    )
  })

  it("contentHash changes when body changes", () => {
    const original = computeHashes(makeTreeWithLabels())
    const modified = makeTreeWithLabels()
    modified.children[0].children[1].value = "Changed body"
    const hashed = computeHashes(modified)

    expect(original.children[0].contentHash).not.toBe(
      hashed.children[0].contentHash
    )
  })

  it("serializes labelHash only for section nodes", () => {
    const tree = computeHashes(makeTreeWithLabels())
    const manifest = serialize(tree)

    // Section node should have labelHash
    const sectionSerialized = manifest.tree.children["my-section"]
    expect(sectionSerialized.labelHash).toBeDefined()

    // Leaf nodes inside should NOT have labelHash
    const proseSerialized = sectionSerialized.children["prose:0"]
    expect(proseSerialized.labelHash).toBeUndefined()
  })

  it("round-trips labelHash through serialize/deserialize", () => {
    const tree = computeHashes(makeTreeWithLabels())
    const manifest = serialize(tree)
    const restored = deserialize(manifest)

    expect(restored.children[0].labelHash).toBe(tree.children[0].labelHash)
  })
})

describe("getInertValue", () => {
  it("returns value for inert element", () => {
    const tree = computeHashes(makeSimpleTree())
    const value = getInertValue(tree, "section-a/link:0")
    expect(value).toBe("https://example.com")
  })

  it("returns undefined for translatable element", () => {
    const tree = computeHashes(makeSimpleTree())
    const value = getInertValue(tree, "section-a/prose:0")
    expect(value).toBeUndefined()
  })

  it("returns undefined for non-existent path", () => {
    const tree = computeHashes(makeSimpleTree())
    expect(getInertValue(tree, "nonexistent/path")).toBeUndefined()
  })
})

describe("validate", () => {
  it("reports 100% coverage with stable IDs", () => {
    const tree = computeHashes(
      createNode({
        id: "root",
        nodeType: "root",
        contentType: "mixed",
        elementType: "root",
        children: [
          createNode({
            id: "stable-section",
            nodeType: "section",
            contentType: "mixed",
            elementType: "section",
          }),
          createNode({
            id: "another-stable",
            nodeType: "section",
            contentType: "mixed",
            elementType: "section",
          }),
        ],
      })
    )
    const result = validate(tree)
    expect(result.totalSections).toBe(2)
    expect(result.stableIds).toBe(2)
    expect(result.autoSlugs).toBe(0)
    expect(result.coverage).toBe(100)
    expect(result.duplicateIds).toHaveLength(0)
  })

  it("detects auto-slug sections", () => {
    const tree = computeHashes(
      createNode({
        id: "root",
        nodeType: "root",
        contentType: "mixed",
        elementType: "root",
        children: [
          createNode({
            id: "stable-id",
            nodeType: "section",
            contentType: "mixed",
            elementType: "section",
          }),
          createNode({
            id: "_auto:my-heading",
            nodeType: "section",
            contentType: "mixed",
            elementType: "section",
          }),
        ],
      })
    )
    const result = validate(tree)
    expect(result.stableIds).toBe(1)
    expect(result.autoSlugs).toBe(1)
    expect(result.coverage).toBe(50)
  })

  it("detects duplicate IDs", () => {
    const tree = computeHashes(
      createNode({
        id: "root",
        nodeType: "root",
        contentType: "mixed",
        elementType: "root",
        children: [
          createNode({
            id: "duplicate",
            nodeType: "section",
            contentType: "mixed",
            elementType: "section",
            children: [
              createNode({
                id: "duplicate",
                nodeType: "section",
                contentType: "mixed",
                elementType: "section",
              }),
            ],
          }),
        ],
      })
    )
    const result = validate(tree)
    expect(result.duplicateIds).toContain("duplicate")
  })
})
