import type { TreeNode, DiffResult, DiffEntry } from "./types.js"
import { computeHashes } from "./tree.js"

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
 */
export function diff(oldTree: TreeNode, newTree: TreeNode): DiffResult {
  const oldHashed = oldTree.contentHash ? oldTree : computeHashes(oldTree)
  const newHashed = newTree.contentHash ? newTree : computeHashes(newTree)

  const result: DiffResult = {
    unchanged: [],
    inertDrift: [],
    translatableDrift: [],
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
        // Body unchanged -- label may or may not have changed
        result.unchanged.push(entry)
      }
    } else if (contentChanged) {
      result.translatableDrift.push(entry)
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
