import type { TreeNode, DiffResult, DiffEntry, InertChange } from "./types.js"
import { computeHashes, getNodeByPath } from "./tree.js"

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
 * Collects contentHash values from all translatable leaf descendants, sorts
 * them, and compares. If the sorted sets differ, translatable content changed.
 */
function hasTranslatableChanges(
  oldNode: TreeNode,
  newNode: TreeNode
): boolean {
  // Leaf nodes: if the node has translatable content, any content change is translatable
  if (oldNode.children.length === 0 && newNode.children.length === 0) {
    return (
      oldNode.contentType === "translatable" ||
      newNode.contentType === "translatable" ||
      oldNode.contentType === "mixed" ||
      newNode.contentType === "mixed"
    )
  }

  const oldHashes = collectTranslatableHashes(oldNode)
  const newHashes = collectTranslatableHashes(newNode)

  if (oldHashes.length !== newHashes.length) return true

  oldHashes.sort()
  newHashes.sort()

  for (let i = 0; i < oldHashes.length; i++) {
    if (oldHashes[i] !== newHashes[i]) return true
  }

  return false
}

/** Collect contentHash from all translatable leaf descendants (excludes _label) */
function collectTranslatableHashes(node: TreeNode): string[] {
  const hashes: string[] = []

  for (const child of node.children) {
    // Skip _label -- heading text is tracked via labelHash, not contentHash
    if (child.id === "_label") continue

    if (child.children.length > 0) {
      hashes.push(...collectTranslatableHashes(child))
    } else if (
      child.contentType === "translatable" ||
      (child.contentType === "mixed" && child.value)
    ) {
      hashes.push(child.contentHash)
    }
  }

  return hashes
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

/**
 * Extract detailed inert changes from a diff result.
 *
 * For each inertDrift entry, walks into both trees to find which specific
 * leaf nodes had their anchorHash change, and returns the old/new values
 * with context (element type, attribute name, tag name).
 */
export function extractInertChanges(
  oldTree: TreeNode,
  newTree: TreeNode,
  diffResult: DiffResult
): InertChange[] {
  const changes: InertChange[] = []

  for (const entry of diffResult.inertDrift) {
    const oldNode = getNodeByPath(oldTree, entry.path)
    const newNode = getNodeByPath(newTree, entry.path)
    if (!oldNode || !newNode) continue

    // Leaf node at root level (e.g., frontmatter fields)
    if (oldNode.children.length === 0 && newNode.children.length === 0) {
      if (oldNode.anchorHash !== newNode.anchorHash) {
        extractNodeChanges(oldNode, newNode, entry.path, changes)
      }
    } else {
      collectChangedLeaves(oldNode, newNode, entry.path, changes)
    }
  }

  return changes
}

/** Recursively find leaf nodes whose anchorHash changed */
function collectChangedLeaves(
  oldNode: TreeNode,
  newNode: TreeNode,
  basePath: string,
  changes: InertChange[],
  parentTagName?: string
): void {
  const oldChildMap = new Map<string, TreeNode>()
  for (const child of oldNode.children) {
    oldChildMap.set(child.id, child)
  }

  // Inherit tagName from this node if it's a component
  const tagName = parentTagName ?? oldNode.meta?.tagName

  for (const newChild of newNode.children) {
    const oldChild = oldChildMap.get(newChild.id)
    if (!oldChild) continue

    const childPath = basePath ? `${basePath}/${newChild.id}` : newChild.id

    if (oldChild.anchorHash === newChild.anchorHash) continue

    if (newChild.children.length > 0 && oldChild.children.length > 0) {
      collectChangedLeaves(oldChild, newChild, childPath, changes, tagName)
    } else {
      extractNodeChanges(oldChild, newChild, childPath, changes, tagName)
    }
  }
}

/**
 * Extract one InertChange per changed meta key (or value) from a leaf node.
 * For nodes with meta (links, images, html-tags), emits one change per
 * differing meta key. For plain inert nodes, emits one change for the value.
 */
function extractNodeChanges(
  oldChild: TreeNode,
  newChild: TreeNode,
  childPath: string,
  changes: InertChange[],
  parentTagName?: string
): void {
  const tagName = parentTagName ?? oldChild.meta?.tagName ?? newChild.meta?.tagName

  // For mixed nodes with meta, compare each meta key individually
  if (oldChild.meta && newChild.meta) {
    const allKeys = new Set([
      ...Object.keys(oldChild.meta),
      ...Object.keys(newChild.meta),
    ])

    let emittedMetaChange = false
    for (const metaKey of allKeys) {
      // Skip non-value metadata
      if (metaKey === "tagName" || metaKey === "language") continue
      // For ICU/component-attribute nodes, "name" is descriptive metadata, not a value to diff
      if (metaKey === "name" && (oldChild.elementType === "icu-variable" || oldChild.elementType === "component-attribute")) continue

      const oldVal = oldChild.meta[metaKey]
      const newVal = newChild.meta[metaKey]
      if (oldVal === newVal) continue

      changes.push({
        path: childPath,
        elementType: newChild.elementType,
        oldValue: oldVal ?? "",
        newValue: newVal ?? "",
        key: metaKey,
        tagName,
      })
      emittedMetaChange = true
    }

    // If no meta keys differed, the value itself changed
    if (!emittedMetaChange && (oldChild.value ?? "") !== (newChild.value ?? "")) {
      changes.push({
        path: childPath,
        elementType: newChild.elementType,
        oldValue: oldChild.value ?? "",
        newValue: newChild.value ?? "",
        key: oldChild.meta.key ?? oldChild.meta.name,
        tagName,
      })
    }
  } else {
    // No meta -- plain inert node (inline-code, code-body, etc.)
    changes.push({
      path: childPath,
      elementType: newChild.elementType,
      oldValue: oldChild.value ?? "",
      newValue: newChild.value ?? "",
      key: oldChild.meta?.key ?? oldChild.meta?.name,
      tagName,
    })
  }
}
