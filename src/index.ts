// Core types
export type {
  ContentTreeConfig,
  MarkdownParserConfig,
  JsonParserConfig,
  TreeNode,
  TreeManifest,
  SerializedNode,
  DiffResult,
  DiffEntry,
  ContentType,
  ElementType,
  InertChange,
  ValidationResult,
} from "./core/types.js"

export {
  DEFAULT_CONFIG,
  DEFAULT_MARKDOWN_CONFIG,
  DEFAULT_JSON_CONFIG,
} from "./core/types.js"

// Constants
export {
  AUTO_SLUG_PREFIX,
  LABEL_NODE_ID,
  MANIFEST_VERSION,
} from "./core/constants.js"

// Hash utilities
export { hash, hashChildren, normalizeForHash, EMPTY_HASH } from "./core/hash.js"

// Tree construction and manipulation
export {
  createNode,
  computeHashes,
  walk,
  getNodeByPath,
  getInertValue,
  serialize,
  deserialize,
  hasChanges,
  validate,
} from "./core/tree.js"

// Diff engine
export { diff, extractInertChanges } from "./core/diff.js"

// Parsers
export { parseMarkdown } from "./parsers/markdown.js"
export { parseJson } from "./parsers/json.js"
export { decomposeInline, needsDecomposition } from "./parsers/inline.js"
