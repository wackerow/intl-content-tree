import { describe, it, expect } from "vitest"
import { diff } from "../../src/core/diff.js"
import { createNode, computeHashes } from "../../src/core/tree.js"

function makeTree(
  sections: Array<{
    id: string
    label?: string
    prose: string
    url?: string
  }>
) {
  return computeHashes(
    createNode({
      id: "root",
      nodeType: "root",
      contentType: "mixed",
      elementType: "root",
      children: sections.map((s) => {
        const children = []
        if (s.label !== undefined) {
          children.push(
            createNode({
              id: "_label",
              nodeType: "element",
              contentType: "translatable",
              elementType: "heading",
              value: s.label,
            })
          )
        }
        children.push(
          createNode({
            id: "prose:0",
            nodeType: "element",
            contentType: "translatable",
            elementType: "prose",
            value: s.prose,
          })
        )
        if (s.url) {
          children.push(
            createNode({
              id: "link:0",
              nodeType: "element",
              contentType: "inert",
              elementType: "link",
              value: s.url,
            })
          )
        }
        return createNode({
          id: s.id,
          nodeType: "section",
          contentType: "mixed",
          elementType: "section",
          children,
        })
      }),
    })
  )
}

describe("diff", () => {
  it("no-change: identical trees produce all unchanged", () => {
    const tree = makeTree([
      { id: "intro", prose: "Hello world" },
      { id: "details", prose: "More info" },
    ])
    const result = diff(tree, tree)
    expect(result.unchanged).toHaveLength(2)
    expect(result.translatableDrift).toHaveLength(0)
    expect(result.inertDrift).toHaveLength(0)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.renamed).toHaveLength(0)
    expect(result.reordered).toHaveLength(0)
  })

  it("prose-edit: changed paragraph -> translatableDrift", () => {
    const old = makeTree([{ id: "intro", prose: "Hello world" }])
    const updated = makeTree([{ id: "intro", prose: "Hello universe" }])
    const result = diff(old, updated)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].id).toBe("intro")
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  it("url-change: changed link URL -> inertDrift", () => {
    const old = makeTree([
      { id: "intro", prose: "Hello", url: "https://old.com" },
    ])
    const updated = makeTree([
      { id: "intro", prose: "Hello", url: "https://new.com" },
    ])
    const result = diff(old, updated)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("intro")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("section-add: new section appears -> added", () => {
    const old = makeTree([{ id: "intro", prose: "Hello" }])
    const updated = makeTree([
      { id: "intro", prose: "Hello" },
      { id: "new-section", prose: "New content" },
    ])
    const result = diff(old, updated)
    expect(result.unchanged).toHaveLength(1)
    expect(result.added).toHaveLength(1)
    expect(result.added[0].id).toBe("new-section")
  })

  it("section-remove: section disappears -> removed", () => {
    const old = makeTree([
      { id: "intro", prose: "Hello" },
      { id: "to-remove", prose: "Going away" },
    ])
    const updated = makeTree([{ id: "intro", prose: "Hello" }])
    const result = diff(old, updated)
    expect(result.unchanged).toHaveLength(1)
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].id).toBe("to-remove")
  })

  it("section-rename: ID changed but content same -> renamed", () => {
    const old = makeTree([{ id: "old-name", prose: "Same content" }])
    const updated = makeTree([{ id: "new-name", prose: "Same content" }])
    const result = diff(old, updated)
    expect(result.renamed).toHaveLength(1)
    expect(result.renamed[0].id).toBe("new-name")
    expect(result.renamed[0].oldId).toBe("old-name")
  })

  it("section-reorder: sections swapped -> reordered", () => {
    const old = makeTree([
      { id: "a", prose: "First" },
      { id: "b", prose: "Second" },
    ])
    const updated = makeTree([
      { id: "b", prose: "Second" },
      { id: "a", prose: "First" },
    ])
    const result = diff(old, updated)
    expect(result.reordered).toHaveLength(2)
    const reorderA = result.reordered.find((e) => e.id === "a")
    expect(reorderA).toBeDefined()
    expect(reorderA!.oldIndex).toBe(0)
    expect(reorderA!.newIndex).toBe(1)
  })

  it("mixed-changes: multiple change types in one diff", () => {
    const old = makeTree([
      { id: "unchanged", prose: "Same" },
      { id: "edited", prose: "Original text" },
      { id: "to-remove", prose: "Going away" },
      { id: "to-rename", prose: "Rename me" },
    ])
    const updated = makeTree([
      { id: "unchanged", prose: "Same" },
      { id: "edited", prose: "Modified text" },
      { id: "new-section", prose: "Brand new" },
      { id: "renamed-section", prose: "Rename me" },
    ])
    const result = diff(old, updated)
    expect(result.unchanged).toHaveLength(1)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.added).toHaveLength(1)
    expect(result.removed).toHaveLength(1)
    expect(result.renamed).toHaveLength(1)
    expect(result.renamed[0].oldId).toBe("to-rename")
    expect(result.renamed[0].id).toBe("renamed-section")
  })

  it("whitespace-only: trailing spaces -> unchanged", () => {
    const old = makeTree([{ id: "intro", prose: "Hello world" }])
    const updated = makeTree([{ id: "intro", prose: "Hello world" }])
    const result = diff(old, updated)
    expect(result.unchanged).toHaveLength(1)
  })

  // -- Three-hash model tests --

  it("label-only change: unchanged with labelHashChanged flag", () => {
    const old = makeTree([
      { id: "intro", label: "Original Heading", prose: "Same body" },
    ])
    const updated = makeTree([
      { id: "intro", label: "Updated Heading", prose: "Same body" },
    ])
    const result = diff(old, updated)
    // Body unchanged, so section is in unchanged
    expect(result.unchanged).toHaveLength(1)
    expect(result.unchanged[0].labelHashChanged).toBe(true)
    expect(result.unchanged[0].contentHashChanged).toBe(false)
    expect(result.unchanged[0].anchorHashChanged).toBe(false)
  })

  it("label + body change: translatableDrift with labelHashChanged", () => {
    const old = makeTree([
      { id: "intro", label: "Old Heading", prose: "Old body" },
    ])
    const updated = makeTree([
      { id: "intro", label: "New Heading", prose: "New body" },
    ])
    const result = diff(old, updated)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].labelHashChanged).toBe(true)
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
  })

  it("rename with label change: detected via contentHash + anchorHash match", () => {
    const old = makeTree([
      { id: "old-id", label: "Old Heading", prose: "Same body" },
    ])
    const updated = makeTree([
      { id: "new-id", label: "New Heading", prose: "Same body" },
    ])
    const result = diff(old, updated)
    // contentHash + anchorHash match (body same) -> rename detected
    // even though label changed
    expect(result.renamed).toHaveLength(1)
    expect(result.renamed[0].oldId).toBe("old-id")
    expect(result.renamed[0].id).toBe("new-id")
    expect(result.renamed[0].labelHashChanged).toBe(true)
  })

  it("no label change: labelHashChanged is false", () => {
    const old = makeTree([
      { id: "intro", label: "Same Heading", prose: "Same body" },
    ])
    const result = diff(old, old)
    expect(result.unchanged).toHaveLength(1)
    expect(result.unchanged[0].labelHashChanged).toBe(false)
  })

  // -- Meta hashing tests (links, images, etc.) --

  it("link URL change in meta -> inertDrift", () => {
    function makeLinkTree(href: string) {
      return computeHashes(
        createNode({
          id: "root",
          nodeType: "root",
          contentType: "mixed",
          elementType: "root",
          children: [
            createNode({
              id: "section",
              nodeType: "section",
              contentType: "mixed",
              elementType: "section",
              children: [
                createNode({
                  id: "link:0",
                  nodeType: "element",
                  contentType: "mixed",
                  elementType: "link",
                  value: "Click here",
                  meta: { href },
                }),
              ],
            }),
          ],
        })
      )
    }
    const old = makeLinkTree("/glossary/#erc-20")
    const updated = makeLinkTree("https://example.com")
    const result = diff(old, updated)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].id).toBe("section")
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("image src change in meta -> inertDrift", () => {
    function makeImageTree(src: string) {
      return computeHashes(
        createNode({
          id: "root",
          nodeType: "root",
          contentType: "mixed",
          elementType: "root",
          children: [
            createNode({
              id: "section",
              nodeType: "section",
              contentType: "mixed",
              elementType: "section",
              children: [
                createNode({
                  id: "image:0",
                  nodeType: "element",
                  contentType: "mixed",
                  elementType: "image",
                  value: "Alt text",
                  meta: { src },
                }),
              ],
            }),
          ],
        })
      )
    }
    const old = makeImageTree("/images/old.png")
    const updated = makeImageTree("/images/new.png")
    const result = diff(old, updated)
    expect(result.inertDrift).toHaveLength(1)
    expect(result.inertDrift[0].anchorHashChanged).toBe(true)
    expect(result.inertDrift[0].contentHashChanged).toBe(false)
  })

  it("link display text change -> translatableDrift", () => {
    function makeLinkTree(text: string) {
      return computeHashes(
        createNode({
          id: "root",
          nodeType: "root",
          contentType: "mixed",
          elementType: "root",
          children: [
            createNode({
              id: "section",
              nodeType: "section",
              contentType: "mixed",
              elementType: "section",
              children: [
                createNode({
                  id: "link:0",
                  nodeType: "element",
                  contentType: "mixed",
                  elementType: "link",
                  value: text,
                  meta: { href: "/same-url" },
                }),
              ],
            }),
          ],
        })
      )
    }
    const old = makeLinkTree("Old text")
    const updated = makeLinkTree("New text")
    const result = diff(old, updated)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
    expect(result.translatableDrift[0].anchorHashChanged).toBe(false)
  })

  it("link text + URL both change -> translatableDrift", () => {
    function makeLinkTree(text: string, href: string) {
      return computeHashes(
        createNode({
          id: "root",
          nodeType: "root",
          contentType: "mixed",
          elementType: "root",
          children: [
            createNode({
              id: "section",
              nodeType: "section",
              contentType: "mixed",
              elementType: "section",
              children: [
                createNode({
                  id: "link:0",
                  nodeType: "element",
                  contentType: "mixed",
                  elementType: "link",
                  value: text,
                  meta: { href },
                }),
              ],
            }),
          ],
        })
      )
    }
    const old = makeLinkTree("Old text", "/old-url")
    const updated = makeLinkTree("New text", "/new-url")
    const result = diff(old, updated)
    expect(result.translatableDrift).toHaveLength(1)
    expect(result.translatableDrift[0].contentHashChanged).toBe(true)
    expect(result.translatableDrift[0].anchorHashChanged).toBe(true)
  })
})
