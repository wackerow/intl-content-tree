import type { TreeNode, DiffResult, DiffEntry } from "./types.js"
import { computeHashes } from "./tree.js"
import { EMPTY_HASH } from "./hash.js"

interface IndexedNode {
  node: TreeNode
  path: string
  index: number
}

/** Build a map of id -> { node, path, index } for a tree's direct children */
function indexChildren(
  node: TreeNode,
  parentPath: string = ""
): Map<string, IndexedNode> {
  const map = new Map<string, IndexedNode>()
  node.children.forEach((child, index) => {
    const path = parentPath ? `${parentPath}/${child.id}` : child.id
    map.set(child.id, { node: child, path, index })
  })
  return map
}

/**
 * Diff two trees and produce a DiffResult.
 * Compares at the immediate children level of each tree (section-level).
 * Recurses into matching sections to find nested changes.
 *
 * Note: at least one tree (typically newTree) should be freshly parsed,
 * not deserialized from a manifest. Deserialized trees lose contentType
 * information, which is needed for structuralDrift classification.
 */
export function diff(oldTree: TreeNode, newTree: TreeNode): DiffResult {
  const oldHashed = oldTree.contentHash ? oldTree : computeHashes(oldTree)
  const newHashed = newTree.contentHash ? newTree : computeHashes(newTree)

  const result: DiffResult = {
    unchanged: [],
    inertDrift: [],
    translatableDrift: [],
    structuralDrift: [],
    added: [],
    removed: [],
    renamed: [],
    reordered: [],
  }

  diffLevel(oldHashed, newHashed, "", result)
  return result
}

function diffLevel(
  oldNode: TreeNode,
  newNode: TreeNode,
  parentPath: string,
  result: DiffResult
): void {
  const oldIndex = indexChildren(oldNode, parentPath)
  const newIndex = indexChildren(newNode, parentPath)

  const oldIds = new Set(oldIndex.keys())
  const newIds = new Set(newIndex.keys())

  const commonIds = [...oldIds].filter((id) => newIds.has(id))
  const removedCandidates = [...oldIds].filter((id) => !newIds.has(id))
  const addedCandidates = [...newIds].filter((id) => !oldIds.has(id))

  // Detect renames: removed + added with matching contentHash + anchorHash
  // (labelHash is intentionally excluded -- heading text often changes with ID)
  const renames = new Set<string>()
  const renameTargets = new Set<string>()

  for (const oldId of removedCandidates) {
    const oldEntry = oldIndex.get(oldId)!
    for (const newId of addedCandidates) {
      if (renameTargets.has(newId)) continue
      const newEntry = newIndex.get(newId)!
      if (
        oldEntry.node.contentHash === newEntry.node.contentHash &&
        oldEntry.node.anchorHash === newEntry.node.anchorHash
      ) {
        const labelChanged =
          oldEntry.node.labelHash !== newEntry.node.labelHash
        result.renamed.push({
          id: newId,
          path: newEntry.path,
          oldId,
          contentHashChanged: false,
          anchorHashChanged: false,
          labelHashChanged: labelChanged,
        })
        renames.add(oldId)
        renameTargets.add(newId)
        break
      }
    }
  }

  // Remaining removed
  for (const oldId of removedCandidates) {
    if (renames.has(oldId)) continue
    const entry = oldIndex.get(oldId)!
    result.removed.push({
      id: oldId,
      path: entry.path,
      contentHashChanged: false,
      anchorHashChanged: false,
      labelHashChanged: false,
    })
  }

  // Remaining added
  for (const newId of addedCandidates) {
    if (renameTargets.has(newId)) continue
    const entry = newIndex.get(newId)!
    result.added.push({
      id: newId,
      path: entry.path,
      contentHashChanged: false,
      anchorHashChanged: false,
      labelHashChanged: false,
    })
  }

  // Common IDs: check for changes
  for (const id of commonIds) {
    const oldEntry = oldIndex.get(id)!
    const newEntry = newIndex.get(id)!
    const oldN = oldEntry.node
    const newN = newEntry.node

    const contentChanged = oldN.contentHash !== newN.contentHash
    const anchorChanged = oldN.anchorHash !== newN.anchorHash
    const labelChanged = oldN.labelHash !== newN.labelHash
    const positionChanged = oldEntry.index !== newEntry.index

    const entry: DiffEntry = {
      id,
      path: newEntry.path,
      contentHashChanged: contentChanged,
      anchorHashChanged: anchorChanged,
      labelHashChanged: labelChanged,
    }

    if (!contentChanged && !anchorChanged) {
      if (positionChanged) {
        result.reordered.push({
          ...entry,
          oldIndex: oldEntry.index,
          newIndex: newEntry.index,
        })
      } else {
        result.unchanged.push(entry)
      }
    } else if (contentChanged) {
      // Content hash changed -- but did actual translatable text change,
      // or just the structure (inert nodes added/removed)?
      if (hasTranslatableChanges(oldN, newN)) {
        result.translatableDrift.push(entry)
      } else {
        result.structuralDrift.push(entry)
      }
    } else {
      // Only anchor changed
      result.inertDrift.push(entry)
    }

    // Recurse into children only if both sides have nested sections
    const oldHasSections = oldN.children.some((c) => c.nodeType === "section")
    const newHasSections = newN.children.some((c) => c.nodeType === "section")
    if (oldHasSections && newHasSections && (contentChanged || anchorChanged)) {
      diffLevel(oldN, newN, newEntry.path, result)
    }
  }
}

/**
 * Check whether any translatable content actually changed between two nodes.
 *
 * Compares sorted multisets of contentHashes from translatable leaves.
 * Uses the NEW tree's contentType for classification (deserialized old trees
 * have contentType: "mixed" on all nodes, which is unreliable).
 * Matches by hash, not path -- so section renames don't trigger false positives.
 *
 * For the old tree (may be deserialized), collects all leaf contentHashes
 * that are NOT EMPTY_HASH (inert leaves have EMPTY_HASH).
 */
function hasTranslatableChanges(
  oldNode: TreeNode,
  newNode: TreeNode
): boolean {
  // Leaf nodes: use new tree's contentType
  if (oldNode.children.length === 0 && newNode.children.length === 0) {
    return (
      newNode.contentType === "translatable" ||
      (newNode.contentType === "mixed" && !!newNode.value)
    )
  }

  // New tree: collect hashes from translatable leaves (contentType is reliable)
  const newHashes: string[] = []
  collectTranslatableHashes(newNode, newHashes)

  // Old tree: collect hashes from all non-EMPTY leaf nodes
  // (contentType is unreliable from deserialization, but EMPTY_HASH
  // reliably identifies inert leaves since their contentHash = hash(""))
  const oldHashes: string[] = []
  collectNonEmptyLeafHashes(oldNode, oldHashes)

  // Sort and compare as multisets
  newHashes.sort()
  oldHashes.sort()

  if (newHashes.length !== oldHashes.length) return true
  for (let i = 0; i < newHashes.length; i++) {
    if (newHashes[i] !== oldHashes[i]) return true
  }
  return false
}

/** Collect contentHashes from translatable leaves using contentType (new tree) */
function collectTranslatableHashes(node: TreeNode, hashes: string[]): void {
  for (const child of node.children) {
    if (child.id === "_label") continue
    if (child.children.length > 0) {
      collectTranslatableHashes(child, hashes)
    } else if (
      child.contentType === "translatable" ||
      (child.contentType === "mixed" && child.value)
    ) {
      hashes.push(child.contentHash)
    }
  }
}

/** Collect contentHashes from leaf nodes that aren't EMPTY_HASH (old tree) */
function collectNonEmptyLeafHashes(node: TreeNode, hashes: string[]): void {
  for (const child of node.children) {
    if (child.id === "_label") continue
    if (child.children.length > 0) {
      collectNonEmptyLeafHashes(child, hashes)
    } else if (child.contentHash !== EMPTY_HASH) {
      hashes.push(child.contentHash)
    }
  }
}

/**
 * Map a tree node path to the nearest ancestor section's ID.
 * Useful for mapping fine-grained diff paths (e.g., "my-section/component:2/link:0")
 * to the heading {#id} anchor that the pipeline uses for retranslation.
 */
export function getContainingSection(
  root: TreeNode,
  path: string
): string | undefined {
  const parts = path.split("/")
  let current: TreeNode | undefined = root
  let lastSectionId: string | undefined

  for (const part of parts) {
    if (!current) return lastSectionId
    current = current.children.find((c) => c.id === part)
    if (current?.nodeType === "section") {
      lastSectionId = current.id
    }
  }

  return lastSectionId
}

