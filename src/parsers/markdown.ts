import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml"
import type {
  TreeNode,
  ContentTreeConfig,
  MarkdownParserConfig,
} from "../core/types.js"
import { DEFAULT_CONFIG, DEFAULT_MARKDOWN_CONFIG } from "../core/types.js"
import { AUTO_SLUG_PREFIX, LABEL_NODE_ID } from "../core/constants.js"
import { normalizeForHash } from "../core/hash.js"
import { createNode, computeHashes } from "../core/tree.js"
import { decomposeInline } from "./inline.js"

// Hoisted regex patterns (compiled once, not per-line)
const FENCE_RE = /^(\s*)(```+)(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.+)$/
// Only matches clean opening/self-closing tags -- not <div>content</div>.
// Allows leading indentation so block components nested inside a container
// (e.g. `  <Card .../>` inside `<Grid>`) are still detected; the trailing
// `>\s*$` keeps the "tag alone on its line" guard intact.
const COMPONENT_RE = /^\s*<([A-Z][A-Za-z0-9]*|[a-z][\w-]*)(\s[^>]*)?(\/)?>\s*$/
// Start of a (possibly multi-line) JSX opening tag: `<Component` followed by
// whitespace or end-of-line, with no closing `>` yet on the line. The closing
// `>` is found by a quote/brace-aware scan (see matchMultilineOpenTag) so that
// `>` inside attribute values (title="a > b") or JSX expressions ({{ a > b }})
// does not terminate the tag early.
const OPEN_TAG_START_RE = /^\s*<([A-Z][A-Za-z0-9]*|[a-z][\w-]*)(\s|$)/
const ATTR_RE = /(\w[\w-]*)=(?:"([^"]*)"|{([^}]*)}|'([^']*)')/g

/**
 * Parse markdown/MDX content into a TreeNode tree.
 *
 * Group structure is derived from headings with {#id} anchors.
 * Each heading creates a group node; content between headings
 * becomes child elements of the nearest preceding heading.
 */
export function parseMarkdown(
  content: string,
  config?: Partial<ContentTreeConfig>,
  parserConfig?: Partial<MarkdownParserConfig>
): TreeNode {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const pcfg = { ...DEFAULT_MARKDOWN_CONFIG, ...parserConfig }

  const lines = content.split("\n")
  const root = createNode({
    id: "root",
    nodeType: "root",
    contentType: "mixed",
    elementType: "root",
  })

  // Parse frontmatter as YAML (scalars, sequences, mappings, block scalars)
  let lineIndex = 0
  if (lines[0]?.trim() === "---") {
    let end = 1
    while (end < lines.length && lines[end].trim() !== "---") end++
    // Re-join with LF only: a CRLF file would otherwise leave a stray `\r` on
    // the block's last scalar, which YAML keeps but the author never wrote
    const block = lines
      .slice(1, end)
      .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
      .join("\n")
    const { nodes, parseError } = parseFrontmatter(block, cfg)
    root.children.push(...nodes)
    if (parseError) root.meta = { ...root.meta, frontmatterParseError: "true" }
    lineIndex = end < lines.length ? end + 1 : end // skip closing ---
  }

  // Track section hierarchy: stack of [level, node]
  const sectionStack: Array<{ level: number; node: TreeNode }> = []
  let currentContainer: TreeNode = root
  let proseBuffer: string[] = []
  let inCodeFence = false
  let codeFenceLang = ""
  let codeFenceBacktickCount = 0
  let codeLines: string[] = []

  function flushProse(): void {
    const text = proseBuffer.join("\n").trim()
    if (text) {
      const elements = parseInlineElements(text, cfg)
      if (cfg.depth === "element") {
        currentContainer.children.push(...elements)
      } else {
        currentContainer.children.push(
          createNode({
            id: `prose:${currentContainer.children.length}`,
            nodeType: "element",
            contentType: "translatable",
            elementType: "prose",
            value: normalizeForHash(text),
          })
        )
      }
    }
    proseBuffer = []
  }

  function flushCodeFence(): void {
    const codeContent = codeLines.join("\n")
    const isProse = pcfg.proseFenceTags.includes(codeFenceLang.toLowerCase())

    if (isProse) {
      currentContainer.children.push(
        createNode({
          id: `code-fence:${currentContainer.children.length}`,
          nodeType: "element",
          contentType: "translatable",
          elementType: "prose",
          value: normalizeForHash(codeContent),
          meta: { language: codeFenceLang },
        })
      )
    } else {
      const comments = extractComments(codeContent, codeFenceLang, pcfg)
      if (cfg.depth === "element" && comments.length > 0) {
        for (const comment of comments) {
          currentContainer.children.push(
            createNode({
              id: `code-comment:${currentContainer.children.length}`,
              nodeType: "element",
              contentType: "translatable",
              elementType: "code-comment",
              value: comment,
              meta: { language: codeFenceLang },
            })
          )
        }
      }
      currentContainer.children.push(
        createNode({
          id: `code-fence:${currentContainer.children.length}`,
          nodeType: "element",
          contentType: "inert",
          elementType: "code-body",
          value: normalizeForHash(codeContent),
          meta: { language: codeFenceLang },
        })
      )
    }
    codeLines = []
    inCodeFence = false
    codeFenceLang = ""
    codeFenceBacktickCount = 0
  }

  function pushSection(level: number, id: string, headingText: string): void {
    flushProse()

    while (
      sectionStack.length > 0 &&
      sectionStack[sectionStack.length - 1].level >= level
    ) {
      sectionStack.pop()
    }

    const section = createNode({
      id,
      nodeType: "section",
      contentType: "mixed",
      elementType: "section",
    })

    section.children.push(
      createNode({
        id: LABEL_NODE_ID,
        nodeType: "element",
        contentType: "translatable",
        elementType: "heading",
        value: headingText,
        meta: { level: String(level) },
      })
    )

    if (sectionStack.length > 0) {
      sectionStack[sectionStack.length - 1].node.children.push(section)
    } else {
      root.children.push(section)
    }

    sectionStack.push({ level, node: section })
    currentContainer = section
  }

  // Main parse loop
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]

    // Code fence open/close
    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      const backtickCount = fenceMatch[2].length

      if (!inCodeFence) {
        flushProse()
        inCodeFence = true
        codeFenceBacktickCount = backtickCount
        codeFenceLang = fenceMatch[3].trim()
        codeLines = []
        lineIndex++
        continue
      } else {
        if (backtickCount >= codeFenceBacktickCount && !fenceMatch[3].trim()) {
          flushCodeFence()
          lineIndex++
          continue
        }
      }
    }

    if (inCodeFence) {
      codeLines.push(line)
      lineIndex++
      continue
    }

    // Heading detection
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      const level = headingMatch[1].length
      const rawText = headingMatch[2]

      let id: string
      let headingText: string

      if (pcfg.headingIdPattern) {
        const idMatch = rawText.match(pcfg.headingIdPattern)
        if (idMatch) {
          id = idMatch[1]
          headingText = rawText.replace(pcfg.headingIdPattern, "").trim()
        } else {
          id = `${AUTO_SLUG_PREFIX}${slugify(rawText)}`
          headingText = rawText
        }
      } else {
        id = `${AUTO_SLUG_PREFIX}${slugify(rawText)}`
        headingText = rawText
      }

      pushSection(level, id, headingText)
      lineIndex++
      continue
    }

    // HTML/JSX component detection
    const componentMatch = line.match(COMPONENT_RE)
    if (componentMatch) {
      flushProse()
      const tagName = componentMatch[1]
      const isSelfClosing = line.trimEnd().endsWith("/>")
      const attrs = parseAttributes(line, cfg)
      const attrChildren = buildAttributeChildren(attrs)

      if (isSelfClosing) {
        currentContainer.children.push(
          createNode({
            id: `component:${currentContainer.children.length}`,
            nodeType: "element",
            contentType: attrChildren.length > 0 ? "mixed" : "inert",
            elementType: "component",
            meta: { tagName },
            children: attrChildren,
          })
        )
      } else {
        // Opening tag: collect until closing tag, parse children
        const componentLines: string[] = []
        const closeTag = `</${tagName}>`
        const openTagRe = new RegExp(`<${tagName}[\\s>/]`)
        lineIndex++
        let depth = 1
        while (lineIndex < lines.length) {
          const cline = lines[lineIndex]
          if (openTagRe.test(cline)) depth++
          if (cline.includes(closeTag)) {
            depth--
            if (depth === 0) break
          }
          componentLines.push(cline)
          lineIndex++
        }

        const innerContent = componentLines.join("\n")
        const innerTree = parseMarkdown(innerContent, config, parserConfig)
        const componentNode = createNode({
          id: `component:${currentContainer.children.length}`,
          nodeType: "element",
          contentType: "mixed",
          elementType: "component",
          meta: { tagName },
          children: [...attrChildren, ...innerTree.children],
        })
        currentContainer.children.push(componentNode)
      }
      lineIndex++
      continue
    }

    // Multi-line JSX opening tag (attribute values span multiple lines):
    //   <ExpandableCard
    //   title="..."
    //   contentPreview="...">
    // COMPONENT_RE above only matches when the closing `>` is on the same line,
    // so without this these would fall through to prose and their translatable
    // attributes would never be extracted.
    const multiOpen = matchMultilineOpenTag(lines, lineIndex)
    if (multiOpen) {
      flushProse()
      const { tagName, openTag, isSelfClosing, closeLineIndex, remainder } =
        multiOpen
      const attrs = parseAttributes(openTag, cfg)
      const attrChildren = buildAttributeChildren(attrs)

      if (isSelfClosing) {
        currentContainer.children.push(
          createNode({
            id: `component:${currentContainer.children.length}`,
            nodeType: "element",
            contentType: attrChildren.length > 0 ? "mixed" : "inert",
            elementType: "component",
            meta: { tagName },
            children: attrChildren,
          })
        )
        lineIndex = closeLineIndex + 1
        if (remainder.trim()) proseBuffer.push(remainder)
        continue
      }

      // Opening tag: collect inner content until the matching closing tag,
      // seeded with any inline content after `>` on the closing line.
      const componentLines: string[] = []
      if (remainder.trim()) componentLines.push(remainder)
      const closeTag = `</${tagName}>`
      const openTagRe = new RegExp(`<${tagName}[\\s>/]`)
      let i = closeLineIndex + 1
      let depth = 1
      while (i < lines.length) {
        const cline = lines[i]
        if (openTagRe.test(cline)) depth++
        if (cline.includes(closeTag)) {
          depth--
          if (depth === 0) break
        }
        componentLines.push(cline)
        i++
      }
      const innerTree = parseMarkdown(
        componentLines.join("\n"),
        config,
        parserConfig
      )
      currentContainer.children.push(
        createNode({
          id: `component:${currentContainer.children.length}`,
          nodeType: "element",
          contentType: "mixed",
          elementType: "component",
          meta: { tagName },
          children: [...attrChildren, ...innerTree.children],
        })
      )
      lineIndex = i + 1
      continue
    }

    // Regular prose line
    proseBuffer.push(line)
    lineIndex++
  }

  // Flush remaining
  if (inCodeFence) flushCodeFence()
  flushProse()

  return computeHashes(root)
}

// ---------- Frontmatter ----------

/**
 * Parse a frontmatter block (the text between the `---` fences) into root-level
 * nodes.
 *
 * Scalars become element nodes; sequences and mappings become section nodes
 * with one child per item/subkey, mirroring how the JSON parser shapes arrays
 * and objects. That shape is what makes item edits, additions, removals, and
 * reorders roll up into the parent hash.
 *
 * When the block is not valid YAML the parse falls back to the legacy
 * single-line `key: value` scan so a malformed block still yields the fields it
 * can, and `parseError` is reported so callers can surface it.
 */
function parseFrontmatter(
  block: string,
  cfg: ContentTreeConfig
): { nodes: TreeNode[]; parseError: boolean } {
  if (!block.trim()) return { nodes: [], parseError: false }

  let contents: unknown
  try {
    const doc = parseDocument(block)
    if (doc.errors.length > 0) {
      return { nodes: parseFrontmatterLines(block, cfg), parseError: true }
    }
    contents = doc.contents
  } catch {
    return { nodes: parseFrontmatterLines(block, cfg), parseError: true }
  }

  // A block of only comments parses to null contents -- no fields, no error
  if (contents === null || contents === undefined) {
    return { nodes: [], parseError: false }
  }
  // Valid YAML, but not a mapping (a bare scalar or sequence): no fields to
  // derive, so fall back and flag it
  if (!isMap(contents)) {
    return { nodes: parseFrontmatterLines(block, cfg), parseError: true }
  }

  const nodes: TreeNode[] = []
  for (const pair of contents.items) {
    const key = scalarKey(pair.key)
    if (!key) continue
    nodes.push(buildFrontmatterNode(`frontmatter:${key}`, key, pair.value, cfg))
  }
  return { nodes, parseError: false }
}

/**
 * Build a node for one frontmatter value.
 *
 * `key` is the field name that governs translatability: sequence items inherit
 * the sequence's key, mapping values take their own subkey.
 */
function buildFrontmatterNode(
  id: string,
  key: string,
  value: unknown,
  cfg: ContentTreeConfig
): TreeNode {
  if (isSeq(value)) {
    return createNode({
      id,
      nodeType: "section",
      contentType: "mixed",
      elementType: "frontmatter-field",
      meta: { key },
      children: value.items.map((item, i) =>
        buildFrontmatterNode(`${i}`, key, item, cfg)
      ),
    })
  }

  if (isMap(value)) {
    const children: TreeNode[] = []
    for (const pair of value.items) {
      const subKey = scalarKey(pair.key)
      if (!subKey) continue
      children.push(buildFrontmatterNode(subKey, subKey, pair.value, cfg))
    }
    return createNode({
      id,
      nodeType: "section",
      contentType: "mixed",
      elementType: "frontmatter-field",
      meta: { key },
      children,
    })
  }

  return createNode({
    id,
    nodeType: "element",
    contentType: cfg.translatableAttributes.includes(key)
      ? "translatable"
      : "inert",
    elementType: "frontmatter-field",
    value: scalarText(value),
    meta: { key },
  })
}

/**
 * The scalar as the author wrote it.
 *
 * Strings use the resolved value (quotes stripped, escapes and block folding
 * applied); everything else uses the original source text so dates, numbers,
 * and booleans are never re-serialized (`1.10` stays `1.10`, not `1.1`).
 */
function scalarText(value: unknown): string {
  if (isScalar(value)) {
    if (typeof value.value === "string") return value.value
    if (value.value === null || value.value === undefined) return ""
    return value.source ?? String(value.value)
  }
  if (isAlias(value)) return `*${value.source}`
  return ""
}

/** A mapping key as a string, or undefined when it is not a usable key */
function scalarKey(value: unknown): string | undefined {
  if (!isScalar(value)) return undefined
  const text = scalarText(value)
  return text || undefined
}

/** Legacy single-line `key: value` scan, kept as the invalid-YAML fallback */
function parseFrontmatterLines(
  block: string,
  cfg: ContentTreeConfig
): TreeNode[] {
  const nodes: TreeNode[] = []
  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx <= 0) continue
    const key = line.slice(0, colonIdx).trim()
    nodes.push(
      createNode({
        id: `frontmatter:${key}`,
        nodeType: "element",
        contentType: cfg.translatableAttributes.includes(key)
          ? "translatable"
          : "inert",
        elementType: "frontmatter-field",
        value: line.slice(colonIdx + 1).trim(),
        meta: { key },
      })
    )
  }
  return nodes
}

// ---------- Helpers ----------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
}

function extractComments(
  code: string,
  lang: string,
  pcfg: MarkdownParserConfig
): string[] {
  const comments: string[] = []

  const prefixes =
    lang in pcfg.commentSyntax
      ? pcfg.commentSyntax[lang]
      : ["//", "#"]

  for (const line of code.split("\n")) {
    const trimmed = line.trim()
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        const comment = trimmed.slice(prefix.length).trim()
        if (comment) comments.push(comment)
        break
      }
    }
  }

  return comments
}

/**
 * Detect a JSX opening tag whose attributes span multiple lines, starting at
 * lines[start]. Returns null when lines[start] is not such a tag — including
 * the single-line case (closing `>` on the start line), which the COMPONENT_RE
 * fast path handles. The closing `>` is found by a quote- and brace-aware scan
 * so a `>` inside an attribute value (title="a > b") or a JSX expression
 * ({{ a > b }}) does not terminate the tag early.
 */
function matchMultilineOpenTag(
  lines: string[],
  start: number
): {
  tagName: string
  openTag: string
  isSelfClosing: boolean
  closeLineIndex: number
  remainder: string
} | null {
  const m = lines[start].match(OPEN_TAG_START_RE)
  if (!m) return null
  const tagName = m[1]

  let quote: string | null = null
  let brace = 0
  for (let li = start; li < lines.length; li++) {
    const line = lines[li]
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci]
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === "{") {
        brace++
      } else if (ch === "}") {
        if (brace > 0) brace--
      } else if (ch === ">" && brace === 0) {
        if (li === start) return null // single-line: let COMPONENT_RE handle it
        const openTag = [
          ...lines.slice(start, li),
          line.slice(0, ci + 1),
        ].join("\n")
        const isSelfClosing = line.slice(0, ci).trimEnd().endsWith("/")
        const remainder = line.slice(ci + 1)
        return { tagName, openTag, isSelfClosing, closeLineIndex: li, remainder }
      }
    }
  }
  return null // no closing `>` found — treat as prose
}

function parseAttributes(
  line: string,
  cfg: ContentTreeConfig
): { translatableAttrs: Record<string, string>; inertAttrs: Record<string, string> } {
  const translatableAttrs: Record<string, string> = {}
  const inertAttrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match

  while ((match = ATTR_RE.exec(line)) !== null) {
    const name = match[1]
    const value = match[2] ?? match[3] ?? match[4] ?? ""
    if (cfg.translatableAttributes.includes(name)) {
      translatableAttrs[name] = value
    } else {
      inertAttrs[name] = value
    }
  }

  return { translatableAttrs, inertAttrs }
}

/** Create child nodes for component attributes, split by translatable/inert */
function buildAttributeChildren(
  attrs: { translatableAttrs: Record<string, string>; inertAttrs: Record<string, string> }
): TreeNode[] {
  const children: TreeNode[] = []

  for (const [name, value] of Object.entries(attrs.translatableAttrs)) {
    children.push(
      createNode({
        id: `attr:${name}`,
        nodeType: "element",
        contentType: "translatable",
        elementType: "component-attribute",
        value,
        meta: { name },
      })
    )
  }

  for (const [name, value] of Object.entries(attrs.inertAttrs)) {
    children.push(
      createNode({
        id: `attr:${name}`,
        nodeType: "element",
        contentType: "inert",
        elementType: "component-attribute",
        value,
        meta: { name },
      })
    )
  }

  return children
}

function parseInlineElements(
  text: string,
  cfg: ContentTreeConfig
): TreeNode[] {
  if (cfg.depth === "group") {
    return [
      createNode({
        id: `prose:0`,
        nodeType: "element",
        contentType: "translatable",
        elementType: "prose",
        value: normalizeForHash(text),
      }),
    ]
  }

  return decomposeInline(text)
}
