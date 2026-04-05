import type { TreeNode } from "../core/types.js"
import { normalizeForHash } from "../core/hash.js"
import { createNode } from "../core/tree.js"

// Matches: inline code, images, markdown links, HTML tags with attributes
const INLINE_RE =
  /(?:`([^`]+)`)|(?:!\[([^\]]*)\]\(([^)]+)\))|(?:\[([^\]]+)\]\(([^)]+)\))|(?:<(\w[\w-]*)\s+([^>]*)\/?>(?:([^<]*)<\/\6>)?)/g
const ATTR_RE = /(\w[\w-]*)=(?:"([^"]*)"|{([^}]*)}|'([^']*)')/g

// ICU variable name at the start of a brace expression: {name...}
const ICU_OPEN_RE = /\{(\w+)/g

/**
 * Find ICU MessageFormat expressions with brace-depth tracking.
 * Handles nested braces in plural/select: {count, plural, one {# item} other {# items}}
 */
function findIcuExpressions(
  text: string
): Array<{ index: number; length: number; name: string; raw: string }> {
  const results: Array<{
    index: number
    length: number
    name: string
    raw: string
  }> = []
  ICU_OPEN_RE.lastIndex = 0
  let m
  while ((m = ICU_OPEN_RE.exec(text)) !== null) {
    const start = m.index
    let depth = 1
    let i = start + 1
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++
      else if (text[i] === "}") depth--
      i++
    }
    if (depth === 0) {
      const raw = text.slice(start, i)
      results.push({ index: start, length: raw.length, name: m[1], raw })
      ICU_OPEN_RE.lastIndex = i
    }
  }
  return results
}

/** Parse attributes from an inline HTML tag's attribute string */
function parseInlineAttrs(attrString: string): Record<string, string> {
  const meta: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match
  while ((match = ATTR_RE.exec(attrString)) !== null) {
    meta[match[1]] = match[2] ?? match[3] ?? match[4] ?? ""
  }
  return meta
}

/**
 * Decompose a string into translatable prose + inert inline elements.
 *
 * Detects: inline code, markdown links, images, HTML tags (with attributes),
 * and ICU MessageFormat variables.
 *
 * Returns child nodes suitable for merkle hashing where:
 * - Prose fragments are translatable (contentHash)
 * - URLs, src, variable names are inert (anchorHash)
 */
export function decomposeInline(text: string): TreeNode[] {
  const elements: TreeNode[] = []
  let idx = 0

  // First pass: collect all match positions from both regexes
  const matches: Array<{
    index: number
    length: number
    node: TreeNode
  }> = []

  // Inline elements (code, links, images, HTML tags)
  INLINE_RE.lastIndex = 0
  let m
  while ((m = INLINE_RE.exec(text)) !== null) {
    let node: TreeNode

    if (m[1] !== undefined) {
      // Inline code
      node = createNode({
        id: `inline-code:${idx++}`,
        nodeType: "element",
        contentType: "inert",
        elementType: "inline-code",
        value: m[1],
      })
    } else if (m[2] !== undefined || m[3] !== undefined) {
      // Image
      node = createNode({
        id: `image:${idx++}`,
        nodeType: "element",
        contentType: m[2] ? "mixed" : "inert",
        elementType: "image",
        value: m[2] || undefined,
        meta: { src: m[3] },
      })
    } else if (m[4] !== undefined) {
      // Markdown link
      node = createNode({
        id: `link:${idx++}`,
        nodeType: "element",
        contentType: "mixed",
        elementType: "link",
        value: m[4],
        meta: { href: m[5] },
      })
    } else if (m[6] !== undefined) {
      // HTML tag with attributes
      const tagAttrs = parseInlineAttrs(m[7] || "")
      node = createNode({
        id: `html-tag:${idx++}`,
        nodeType: "element",
        contentType: m[8] ? "mixed" : "inert",
        elementType: "html-tag",
        value: m[8] || undefined,
        meta: { tagName: m[6], ...tagAttrs },
      })
    } else {
      continue
    }

    matches.push({ index: m.index, length: m[0].length, node })
  }

  // ICU variables (with brace-depth tracking for plural/select)
  for (const icu of findIcuExpressions(text)) {
    const overlaps = matches.some(
      (existing) =>
        icu.index < existing.index + existing.length &&
        icu.index + icu.length > existing.index
    )
    if (overlaps) continue

    matches.push({
      index: icu.index,
      length: icu.length,
      node: createNode({
        id: `icu:${idx++}`,
        nodeType: "element",
        contentType: "inert",
        elementType: "icu-variable",
        value: icu.raw,
        meta: { name: icu.name },
      }),
    })
  }

  // Sort by position
  matches.sort((a, b) => a.index - b.index)

  // Build final list: prose between matches + the matches themselves
  let lastEnd = 0
  for (const match of matches) {
    if (match.index > lastEnd) {
      const prose = text.slice(lastEnd, match.index).trim()
      if (prose) {
        elements.push(
          createNode({
            id: `prose:${idx++}`,
            nodeType: "element",
            contentType: "translatable",
            elementType: "prose",
            value: normalizeForHash(prose),
          })
        )
      }
    }
    elements.push(match.node)
    lastEnd = match.index + match.length
  }

  // Trailing prose
  if (lastEnd < text.length) {
    const prose = text.slice(lastEnd).trim()
    if (prose) {
      elements.push(
        createNode({
          id: `prose:${idx++}`,
          nodeType: "element",
          contentType: "translatable",
          elementType: "prose",
          value: normalizeForHash(prose),
        })
      )
    }
  }

  return elements
}

/** Check if a string contains patterns that need decomposition */
export function needsDecomposition(value: string): boolean {
  return (
    /<[a-zA-Z][\w-]*[\s>]/.test(value) ||
    /\{\w+[},\s]/.test(value)
  )
}
