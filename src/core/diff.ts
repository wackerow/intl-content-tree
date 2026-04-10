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
 * Uses the NEW tree's contentType for classification (deserialized old trees
 * have contentType: "mixed" on all nodes, which is unreliable).
 * Uses EMPTY_HASH to detect removed translatable nodes from the old tree
 * (inert nodes have contentHash === EMPTY_HASH, translatable nodes don't).
 */
function hasTranslatableChanges(
  oldNode: TreeNode,
  newNode: TreeNode
): boolean {
  // Leaf nodes: use new tree's contentType (old tree may be deserialized with "mixed")
  if (oldNode.children.length === 0 && newNode.children.length === 0) {
    return (
      newNode.contentType === "translatable" ||
      (newNode.contentType === "mixed" && !!newNode.value)
    )
  }

  // Build ID-keyed hash maps for both trees
  const oldHashMap = new Map<string, string>()
  collectHashesById(oldNode, oldHashMap)
  const newHashMap = new Map<string, string>()
  collectHashesById(newNode, newHashMap)

  // Check new tree's translatable leaves: any new or changed?
  for (const child of flattenLeaves(newNode)) {
    if (
      child.contentType === "translatable" ||
      (child.contentType === "mixed" && child.value)
    ) {
      const oldHash = oldHashMap.get(child.path)
      if (oldHash === undefined || oldHash !== child.contentHash) return true
    }
  }

  // Check removed nodes: if a LEAF node with non-EMPTY contentHash was removed,
  // translatable content was deleted. Branch nodes (components, sections) being
  // removed is structural, not translatable.
  const oldLeaves = new Map<string, string>()
  collectLeafHashesById(oldNode, oldLeaves)
  for (const [key, oldHash] of oldLeaves) {
    if (!newHashMap.has(key) && oldHash !== EMPTY_HASH) return true
  }

  return false
}

/** Flatten leaf nodes with their paths */
function flattenLeaves(
  node: TreeNode,
  prefix: string = ""
): Array<TreeNode & { path: string }> {
  const leaves: Array<TreeNode & { path: string }> = []
  for (const child of node.children) {
    if (child.id === "_label") continue
    const path = prefix ? `${prefix}/${child.id}` : child.id
    if (child.children.length > 0) {
      leaves.push(...flattenLeaves(child, path))
    } else {
      leaves.push({ ...child, path })
    }
  }
  return leaves
}

/** Recursively collect contentHash for LEAF nodes only, by path */
function collectLeafHashesById(
  node: TreeNode,
  map: Map<string, string>,
  prefix: string = ""
): void {
  for (const child of node.children) {
    if (child.id === "_label") continue
    const key = prefix ? `${prefix}/${child.id}` : child.id
    if (child.children.length > 0) {
      collectLeafHashesById(child, map, key)
    } else {
      map.set(key, child.contentHash)
    }
  }
}

/** Recursively collect contentHash by path from a tree */
function collectHashesById(
  node: TreeNode,
  map: Map<string, string>,
  prefix: string = ""
): void {
  for (const child of node.children) {
    if (child.id === "_label") continue
    const key = prefix ? `${prefix}/${child.id}` : child.id
    map.set(key, child.contentHash)
    if (child.children.length > 0) {
      collectHashesById(child, map, key)
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

