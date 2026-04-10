// ---------- Configuration ----------

/** Generic config -- applies to all formats */
export interface ContentTreeConfig {
  /**
   * Tree granularity.
   * - "group": top-level groupings only (markdown sections, JSON top-level keys).
   *   Smaller manifests, coarser change detection.
   * - "element": every individual value (links, code spans, images, nested keys).
   *   Larger manifests, precise change detection.
   */
  depth: "group" | "element"

  /**
   * Attribute/field names whose values are translatable.
   * Everything else defaults to inert.
   * Applies across all formats.
   */
  translatableAttributes: string[]
}

/** Markdown/MDX parser config */
export interface MarkdownParserConfig {
  /**
   * Heading ID pattern for section keys.
   * Default: /\{#([^}]+)\}/ (matches {#my-heading-id})
   * Set to null to use auto-generated slugs from heading text.
   */
  headingIdPattern: RegExp | null

  /**
   * Code fence language tags that contain prose (not code).
   * Content inside these fences is treated as translatable.
   */
  proseFenceTags: string[]

  /**
   * Comment syntax families for extracting translatable comments from code.
   * Keys are language family names, values are prefix strings.
   */
  commentSyntax: Record<string, string[]>
}

/** JSON parser config */
export interface JsonParserConfig {
  /**
   * Detect JSON string values that contain markdown syntax.
   * When true, these values are parsed recursively using the markdown parser.
   */
  markdownValueDetector?: (key: string, value: string) => boolean
}

// ---------- Tree ----------

/** Content classification */
export type ContentType = "translatable" | "inert" | "mixed"

/** What kind of content a node represents */
export type ElementType =
  | "prose"
  | "heading"
  | "link"
  | "image"
  | "code-fence"
  | "code-comment"
  | "code-body"
  | "inline-code"
  | "component"
  | "component-attribute"
  | "html-tag"
  | "icu-variable"
  | "frontmatter-field"
  | "json-value"
  | "root"
  | "section"
  | "table"

/** A node in the content tree */
export interface TreeNode {
  /** Unique identifier (explicit ID, key, or auto-generated slug) */
  id: string

  /** Node classification */
  nodeType: "section" | "element" | "root"

  /** Content classification */
  contentType: ContentType

  /** What kind of content this represents */
  elementType: ElementType

  /** Hash of translatable content only (excludes group label) */
  contentHash: string

  /** Hash of inert content only */
  anchorHash: string

  /** Hash of group label text (only meaningful for group/section nodes) */
  labelHash?: string

  /** The actual content */
  value?: string

  /** Metadata (URL for links, path for images, language for code, etc.) */
  meta?: Record<string, string>

  /** Ordered child nodes */
  children: TreeNode[]
}

// ---------- Manifest (serialized form) ----------

/** Serialized form for storage */
export interface TreeManifest {
  version: number
  sourceFile: string
  generatedAt: string
  rootHash: string
  tree: SerializedNode
}

/** Compact serialized node for manifest storage */
export interface SerializedNode {
  contentHash: string
  anchorHash: string
  /** Hash of group label (only present on group/section nodes) */
  labelHash?: string
  /** Child nodes keyed by ID (omitted when no children) */
  children?: Record<string, SerializedNode>
  /** Ordered list of child IDs (omitted when 0-1 children; object key order is not guaranteed) */
  childrenOrder?: string[]
}

// ---------- Diff ----------

/** Result of diffing two trees */
export interface DiffResult {
  /** Groups/elements present in both with no changes */
  unchanged: DiffEntry[]
  /** Groups where only inert content changed (no translation needed) */
  inertDrift: DiffEntry[]
  /** Groups where translatable content changed (translation needed) */
  translatableDrift: DiffEntry[]
  /** Groups where structure changed (nodes added/removed) but no translatable text changed */
  structuralDrift: DiffEntry[]
  /** New groups not in the old tree */
  added: DiffEntry[]
  /** Groups in old tree but not in new */
  removed: DiffEntry[]
  /** Groups that moved (same content, different ID or position) */
  renamed: DiffEntry[]
  /** Groups whose position changed but content is identical */
  reordered: DiffEntry[]
}

export interface DiffEntry {
  /** Node ID */
  id: string
  /** Path in the tree (e.g., "parent-group/child-group") */
  path: string
  /** For renamed: the old ID */
  oldId?: string
  /** For reordered: old position index, new position index */
  oldIndex?: number
  newIndex?: number
  /** Which hashes changed */
  contentHashChanged: boolean
  anchorHashChanged: boolean
  /** Whether the group label changed (only meaningful for group nodes) */
  labelHashChanged: boolean
}

// ---------- Validation ----------

/** Result of validating a tree's readiness for incremental tracking */
export interface ValidationResult {
  /** Total number of groups in the tree */
  totalSections: number
  /** Groups with explicit stable IDs */
  stableIds: number
  /** Groups using auto-generated slugs */
  autoSlugs: number
  /** IDs that appear more than once */
  duplicateIds: string[]
  /** Percentage of groups with stable IDs (0-100) */
  coverage: number
}

// ---------- Defaults ----------

export const DEFAULT_CONFIG: ContentTreeConfig = {
  depth: "group",
  translatableAttributes: [
    "title",
    "description",
    "alt",
    "label",
    "aria-label",
    "placeholder",
  ],
}

export const DEFAULT_MARKDOWN_CONFIG: MarkdownParserConfig = {
  headingIdPattern: /\{#([^}]+)\}/,
  proseFenceTags: ["md", "markdown", "mdx", "text", "txt"],
  commentSyntax: {
    js: ["//"],
    python: ["#"],
    shell: ["#"],
    solidity: ["//"],
  },
}

export const DEFAULT_JSON_CONFIG: JsonParserConfig = {
  markdownValueDetector: (_, value) => {
    if (!value.includes("\n")) return false
    return /\[.+\]\(.+\)|^#{1,4}\s|^\*\*|^- /m.test(value)
  },
}
