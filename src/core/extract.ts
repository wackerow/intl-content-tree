import type {
  TreeNode,
  ChangeSet,
  NodeChange,
  NodeRelocation,
  SectionRename,
} from "./types.js"
import { LABEL_NODE_ID } from "./constants.js"
import { computeHashes } from "./tree.js"

/**
 * Walk two trees and extract per-node changes.
 *
 * Uses Merkle hash comparison: subtrees with matching hashes are skipped
 * entirely (O(changes), not O(tree)). At leaf level, compares values and
 * meta to report individual changes.
 *
 * Detects:
 * - Updated nodes (same path, different hash)
 * - Added nodes (in new tree only)
 * - Removed nodes (in old tree only)
 * - Relocated content (same hash, different path)
 * - Section renames (heading ID changed, overlapping child hashes)
 *
 * Both trees should be freshly parsed for best results.
 */
export function extractChanges(
  oldTree: TreeNode,
  newTree: TreeNode
): ChangeSet {
  const oldHashed = oldTree.contentHash ? oldTree : computeHashes(oldTree)
  const newHashed = newTree.contentHash ? newTree : computeHashes(newTree)

  const changes: NodeChange[] = []
  const relocations: NodeRelocation[] = []
  const sectionRenames: SectionRename[] = []

  // Build global hash-to-path maps for relocation detection
  const oldHashPaths = new Map<string, string[]>()
  const newHashPaths = new Map<string, string[]>()
  collectLeafHashPaths(oldHashed, oldHashPaths)
  collectLeafHashPaths(newHashed, newHashPaths)

  // Walk the trees
  walkLevel(oldHashed, newHashed, "", changes, sectionRenames, oldHashPaths, newHashPaths, relocations)

  return { changes, relocations, sectionRenames }
}

/** Collect all leaf content hashes with their paths */
function collectLeafHashPaths(
  node: TreeNode,
  map: Map<string, string[]>,
  prefix: string = ""
): void {
  for (const child of node.children) {
    if (child.id === LABEL_NODE_ID) continue
    const path = prefix ? `${prefix}/${child.id}` : child.id
    if (child.children.length > 0) {
      collectLeafHashPaths(child, map, path)
    } else {
      // Use combined hash as fingerprint (both translatable and inert content)
      const fingerprint = child.contentHash + ":" + child.anchorHash
      const existing = map.get(fingerprint)
      if (existing) {
        existing.push(path)
      } else {
        map.set(fingerprint, [path])
      }
    }
  }
}

/** Recursive tree walk comparing children at each level */
function walkLevel(
  oldNode: TreeNode,
  newNode: TreeNode,
  parentPath: string,
  changes: NodeChange[],
  sectionRenames: SectionRename[],
  oldHashPaths: Map<string, string[]>,
  newHashPaths: Map<string, string[]>,
  relocations: NodeRelocation[]
): void {
  const oldChildren = new Map<string, TreeNode>()
  for (const child of oldNode.children) {
    oldChildren.set(child.id, child)
  }
  const newChildren = new Map<string, TreeNode>()
  for (const child of newNode.children) {
    newChildren.set(child.id, child)
  }

  const oldIds = new Set(oldChildren.keys())
  const newIds = new Set(newChildren.keys())

  // Common IDs: compare hashes, recurse if different
  for (const id of oldIds) {
    if (!newIds.has(id)) continue
    const oldChild = oldChildren.get(id)!
    const newChild = newChildren.get(id)!
    const path = parentPath ? `${parentPath}/${id}` : id

    if (id === LABEL_NODE_ID) continue

    // Hashes match -> content unchanged, but check if child IDs differ
    // (a section rename doesn't change content hashes, only the child ID)
    if (
      oldChild.contentHash === newChild.contentHash &&
      oldChild.anchorHash === newChild.anchorHash
    ) {
      if (oldChild.children.length > 0 && newChild.children.length > 0) {
        const oldChildIds = new Set(oldChild.children.map((c) => c.id))
        const newChildIds = new Set(newChild.children.map((c) => c.id))
        const idsMatch = oldChildIds.size === newChildIds.size &&
          [...oldChildIds].every((id) => newChildIds.has(id))
        if (!idsMatch) {
          // Child IDs differ -- recurse to detect renames
          walkLevel(oldChild, newChild, path, changes, sectionRenames, oldHashPaths, newHashPaths, relocations)
        }
      }
      continue
    }

    if (oldChild.children.length > 0 && newChild.children.length > 0) {
      // Branch node: recurse
      walkLevel(oldChild, newChild, path, changes, sectionRenames, oldHashPaths, newHashPaths, relocations)
    } else if (oldChild.children.length === 0 && newChild.children.length === 0) {
      // Leaf node: extract specific changes
      emitLeafChanges(oldChild, newChild, path, changes)
    } else {
      // Structure changed (leaf became branch or vice versa)
      emitRemoval(oldChild, parentPath, changes)
      emitAddition(newChild, parentPath, changes, oldHashPaths, relocations)
    }
  }

  // Removed IDs + Added IDs: check for section renames
  const removedIds = [...oldIds].filter((id) => !newIds.has(id) && id !== LABEL_NODE_ID)
  const addedIds = [...newIds].filter((id) => !oldIds.has(id) && id !== LABEL_NODE_ID)

  const matchedOld = new Set<string>()
  const matchedNew = new Set<string>()

  // Detect section renames by overlapping child hashes
  for (const oldId of removedIds) {
    const oldChild = oldChildren.get(oldId)!
    if (oldChild.nodeType !== "section") continue

    for (const newId of addedIds) {
      if (matchedNew.has(newId)) continue
      const newChild = newChildren.get(newId)!
      if (newChild.nodeType !== "section") continue

      if (hasOverlappingChildHashes(oldChild, newChild)) {
        const newPath = parentPath ? `${parentPath}/${newId}` : newId

        sectionRenames.push({
          oldId,
          newId,
          parentPath,
          labelHashChanged: oldChild.labelHash !== newChild.labelHash,
        })

        // Recurse into the renamed section to find changes within it
        walkLevel(oldChild, newChild, newPath, changes, sectionRenames, oldHashPaths, newHashPaths, relocations)

        matchedOld.add(oldId)
        matchedNew.add(newId)
        break
      }
    }
  }

  // Remaining removed (not matched as renames)
  for (const oldId of removedIds) {
    if (matchedOld.has(oldId)) continue
    const oldChild = oldChildren.get(oldId)!
    emitRemoval(oldChild, parentPath, changes)
  }

  // Remaining added (not matched as renames)
  // Relocation detection is handled uniformly in emitAddition
  for (const newId of addedIds) {
    if (matchedNew.has(newId)) continue
    const newChild = newChildren.get(newId)!
    emitAddition(newChild, parentPath, changes, oldHashPaths, relocations)
  }
}

/**
 * Check if two section nodes share any direct child content hashes.
 * Only checks direct children (not deep descendants) for performance.
 * This means renames where ALL direct children also changed will not be detected.
 */
function hasOverlappingChildHashes(
  oldNode: TreeNode,
  newNode: TreeNode
): boolean {
  const oldHashes = new Set<string>()
  for (const child of oldNode.children) {
    if (child.id === LABEL_NODE_ID) continue
    oldHashes.add(child.contentHash + ":" + child.anchorHash)
  }
  for (const child of newNode.children) {
    if (child.id === LABEL_NODE_ID) continue
    if (oldHashes.has(child.contentHash + ":" + child.anchorHash)) return true
  }
  return false
}

/** Emit changes for a leaf node where hashes differ */
function emitLeafChanges(
  oldChild: TreeNode,
  newChild: TreeNode,
  path: string,
  changes: NodeChange[]
): void {
  const tagName = newChild.meta?.tagName ?? oldChild.meta?.tagName

  // Compare meta keys
  if (oldChild.meta && newChild.meta) {
    const allKeys = new Set([
      ...Object.keys(oldChild.meta),
      ...Object.keys(newChild.meta),
    ])

    for (const metaKey of allKeys) {
      if (metaKey === "tagName" || metaKey === "language") continue
      if (metaKey === "name" && (newChild.elementType === "icu-variable" || newChild.elementType === "component-attribute")) continue

      const oldVal = oldChild.meta[metaKey]
      const newVal = newChild.meta[metaKey]

      if (oldVal === newVal) continue

      if (oldVal === undefined) {
        changes.push({
          action: "add",
          path,
          elementType: newChild.elementType,
          contentType: newChild.contentType,
          newValue: newVal,
          key: metaKey,
          tagName,
        })
      } else if (newVal === undefined) {
        changes.push({
          action: "remove",
          path,
          elementType: oldChild.elementType,
          contentType: oldChild.contentType,
          oldValue: oldVal,
          key: metaKey,
          tagName,
        })
      } else {
        changes.push({
          action: "update",
          path,
          elementType: newChild.elementType,
          contentType: newChild.contentType,
          oldValue: oldVal,
          newValue: newVal,
          key: metaKey,
          tagName,
        })
      }
    }
  }

  // Compare values
  const oldVal = oldChild.value ?? ""
  const newVal = newChild.value ?? ""
  if (oldVal !== newVal) {
    changes.push({
      action: "update",
      path,
      elementType: newChild.elementType,
      contentType: newChild.contentType,
      oldValue: oldVal,
      newValue: newVal,
      key: newChild.meta?.key ?? newChild.meta?.name,
      tagName,
    })
  }
}

/** Emit removal changes for a node and all its leaf descendants */
function emitRemoval(
  node: TreeNode,
  parentPath: string,
  changes: NodeChange[]
): void {
  const path = parentPath ? `${parentPath}/${node.id}` : node.id

  if (node.children.length === 0 && node.id !== LABEL_NODE_ID) {
    changes.push({
      action: "remove",
      path,
      elementType: node.elementType,
      contentType: node.contentType,
      oldValue: node.value,
    })
  } else {
    for (const child of node.children) {
      if (child.id === LABEL_NODE_ID) continue
      emitRemoval(child, path, changes)
    }
  }
}

/** Emit addition changes for a node and all its leaf descendants, checking for relocations */
function emitAddition(
  node: TreeNode,
  parentPath: string,
  changes: NodeChange[],
  oldHashPaths?: Map<string, string[]>,
  relocations?: NodeRelocation[]
): void {
  const path = parentPath ? `${parentPath}/${node.id}` : node.id

  if (node.children.length === 0 && node.id !== LABEL_NODE_ID) {
    // Check for relocation: does this content exist in the old tree at a different path?
    if (oldHashPaths && relocations) {
      const fingerprint = node.contentHash + ":" + node.anchorHash
      const oldPaths = oldHashPaths.get(fingerprint)
      if (oldPaths && oldPaths.length > 0 && !oldPaths.includes(path)) {
        relocations.push({
          oldPath: oldPaths[0],
          newPath: path,
          contentHash: node.contentHash,
          anchorHash: node.anchorHash,
        })
        return
      }
    }

    changes.push({
      action: "add",
      path,
      elementType: node.elementType,
      contentType: node.contentType,
      newValue: node.value,
    })
  } else {
    for (const child of node.children) {
      if (child.id === LABEL_NODE_ID) continue
      emitAddition(child, path, changes, oldHashPaths, relocations)
    }
  }
}
