import { hash, hashChildren, EMPTY_HASH } from "./hash.js"
import type {
  TreeNode,
  TreeManifest,
  SerializedNode,
  ContentType,
  ElementType,
  ValidationResult,
} from "./types.js"
import {
  AUTO_SLUG_PREFIX,
  LABEL_NODE_ID,
  MANIFEST_VERSION,
} from "./constants.js"

/** Create a new tree node. Hashes are computed lazily via computeHashes(). */
export function createNode(opts: {
  id: string
  nodeType: TreeNode["nodeType"]
  contentType: ContentType
  elementType: ElementType
  value?: string
  meta?: Record<string, string>
  children?: TreeNode[]
}): TreeNode {
  return {
    id: opts.id,
    nodeType: opts.nodeType,
    contentType: opts.contentType,
    elementType: opts.elementType,
    contentHash: "",
    anchorHash: "",
    value: opts.value,
    meta: opts.meta,
    children: opts.children ?? [],
  }
}

/**
 * Recursively compute content, anchor, and label hashes for a tree.
 * Mutates nodes in place for performance (avoids full tree copy).
 *
 * - Leaf nodes: hash their value based on contentType
 * - Branch nodes: merkle hash of children's hashes
 * - Section nodes: `_label` child is excluded from contentHash;
 *   its hash is stored separately as `labelHash`
 */
export function computeHashes(node: TreeNode): TreeNode {
  // Early return if already hashed
  if (node.contentHash) return node

  // Hash all children first
  for (const child of node.children) {
    computeHashes(child)
  }

  if (node.children.length > 0) {
    // Check if first child is _label (convention: always first when present)
    const hasLabel =
      node.children.length > 0 && node.children[0].id === LABEL_NODE_ID
    const labelChild = hasLabel ? node.children[0] : undefined
    const bodyStart = hasLabel ? 1 : 0

    if (labelChild) {
      node.labelHash = labelChild.contentHash || hash(labelChild.value ?? "")
    }

    if (bodyStart < node.children.length) {
      const bodyHashes: string[] = []
      const anchorHashes: string[] = []
      for (let i = bodyStart; i < node.children.length; i++) {
        bodyHashes.push(node.children[i].contentHash)
        anchorHashes.push(node.children[i].anchorHash)
      }
      node.contentHash = hashChildren(bodyHashes)
      node.anchorHash = hashChildren(anchorHashes)
    } else {
      // Section with only a label and no body content
      node.contentHash = EMPTY_HASH
      node.anchorHash = EMPTY_HASH
    }
  } else {
    // Leaf node: hash value based on content type
    const val = node.value ?? ""
    if (node.contentType === "translatable") {
      node.contentHash = hash(val)
      node.anchorHash = EMPTY_HASH
    } else if (node.contentType === "inert") {
      node.contentHash = EMPTY_HASH
      node.anchorHash = hash(val)
    } else {
      node.contentHash = hash(val)
      node.anchorHash = hash(val)
    }
  }

  return node
}

/** Get all nodes in depth-first order */
export function* walk(node: TreeNode): Generator<TreeNode> {
  yield node
  for (const child of node.children) {
    yield* walk(child)
  }
}

/** Find a node by slash-separated path (e.g., "section-a/subsection-b") */
export function getNodeByPath(
  root: TreeNode,
  path: string
): TreeNode | undefined {
  const parts = path.split("/")
  let current: TreeNode | undefined = root

  for (const part of parts) {
    if (!current) return undefined
    current = current.children.find((c) => c.id === part)
  }

  return current
}

/** Extract the value of an inert element by path. Returns the string value. */
export function getInertValue(
  tree: TreeNode,
  path: string
): string | undefined {
  const node = getNodeByPath(tree, path)
  if (!node) return undefined
  if (node.contentType === "inert" || node.contentType === "mixed") {
    return node.value
  }
  return undefined
}

/** Serialize a tree to a compact manifest format */
export function serialize(
  tree: TreeNode,
  sourceFile: string = ""
): TreeManifest {
  if (!tree.contentHash) computeHashes(tree)

  function serializeNode(node: TreeNode): SerializedNode {
    const serialized: SerializedNode = {
      contentHash: node.contentHash,
      anchorHash: node.anchorHash,
    }

    if (node.labelHash !== undefined) {
      serialized.labelHash = node.labelHash
    }

    if (node.children.length > 0) {
      serialized.children = {}
      for (const child of node.children) {
        serialized.children[child.id] = serializeNode(child)
      }
      // Only include childrenOrder when 2+ children (order is ambiguous)
      if (node.children.length > 1) {
        serialized.childrenOrder = node.children.map((c) => c.id)
      }
    }

    return serialized
  }

  return {
    version: MANIFEST_VERSION,
    sourceFile,
    generatedAt: new Date().toISOString(),
    rootHash: hash(tree.contentHash + tree.anchorHash),
    tree: serializeNode(tree),
  }
}

/** Deserialize a manifest back into a TreeNode tree */
export function deserialize(manifest: TreeManifest): TreeNode {
  function deserializeNode(
    id: string,
    node: SerializedNode,
    depth: number = 0
  ): TreeNode {
    const childMap = node.children ?? {}
    // Use childrenOrder if present; otherwise fall back to object keys (safe for 0-1 children)
    const childOrder = node.childrenOrder ?? Object.keys(childMap)
    const children = childOrder.map((childId) =>
      deserializeNode(childId, childMap[childId], depth + 1)
    )

    const hasChildren = children.length > 0

    const result: TreeNode = {
      id,
      nodeType: depth === 0 ? "root" : hasChildren ? "section" : "element",
      contentType: "mixed",
      elementType: depth === 0 ? "root" : hasChildren ? "section" : "prose",
      contentHash: node.contentHash,
      anchorHash: node.anchorHash,
      children,
    }

    if (node.labelHash !== undefined) {
      result.labelHash = node.labelHash
    }

    return result
  }

  return deserializeNode("root", manifest.tree)
}

/** Quick check: does the tree differ from a stored manifest? */
export function hasChanges(tree: TreeNode, manifest: TreeManifest): boolean {
  if (!tree.contentHash) computeHashes(tree)
  const currentRootHash = hash(tree.contentHash + tree.anchorHash)
  return currentRootHash !== manifest.rootHash
}

/**
 * Validate a tree's readiness for incremental tracking.
 * Reports stable ID coverage, auto-slugs, and duplicates.
 */
export function validate(tree: TreeNode): ValidationResult {
  let totalSections = 0
  let stableIds = 0
  let autoSlugs = 0
  const idCounts = new Map<string, number>()

  for (const node of walk(tree)) {
    if (node.nodeType === "section") {
      totalSections++
      const count = (idCounts.get(node.id) ?? 0) + 1
      idCounts.set(node.id, count)

      if (node.id.startsWith(AUTO_SLUG_PREFIX)) {
        autoSlugs++
      } else {
        stableIds++
      }
    }
  }

  const duplicateIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)

  return {
    totalSections,
    stableIds,
    autoSlugs,
    duplicateIds,
    coverage:
      totalSections > 0
        ? Math.round((stableIds / totalSections) * 100)
        : 100,
  }
}
