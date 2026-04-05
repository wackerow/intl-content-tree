import type {
  TreeNode,
  ContentTreeConfig,
  MarkdownParserConfig,
} from "../core/types.js"
import { DEFAULT_CONFIG, DEFAULT_MARKDOWN_CONFIG } from "../core/types.js"
import { AUTO_SLUG_PREFIX, LABEL_NODE_ID } from "../core/constants.js"
import { normalizeForHash } from "../core/hash.js"
import { createNode, computeHashes } from "../core/tree.js"

// Hoisted regex patterns (compiled once, not per-line)
const FENCE_RE = /^(\s*)(```+)(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.+)$/
// Only matches clean opening/self-closing tags -- not <div>content</div>
const COMPONENT_RE = /^<([A-Z][A-Za-z0-9]*|[a-z][\w-]*)(\s[^>]*)?(\/)?>\s*$/
const ATTR_RE = /(\w[\w-]*)=(?:"([^"]*)"|{([^}]*)}|'([^']*)')/g
const INLINE_RE =
  /(?:`([^`]+)`)|(?:!\[([^\]]*)\]\(([^)]+)\))|(?:\[([^\]]+)\]\(([^)]+)\))|(?:<(\w[\w-]*)\s+([^>]*)\/?>(?:([^<]*)<\/\6>)?)/g

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

  // Parse frontmatter (single-line key: value pairs only; multi-line YAML not supported)
  let lineIndex = 0
  if (lines[0]?.trim() === "---") {
    lineIndex = 1
    while (lineIndex < lines.length && lines[lineIndex].trim() !== "---") {
      const line = lines[lineIndex]
      const colonIdx = line.indexOf(":")
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        const isTranslatable = cfg.translatableAttributes.includes(key)
        root.children.push(
          createNode({
            id: `frontmatter:${key}`,
            nodeType: "element",
            contentType: isTranslatable ? "translatable" : "inert",
            elementType: "frontmatter-field",
            value: value,
            meta: { key },
          })
        )
      }
      lineIndex++
    }
    if (lineIndex < lines.length) lineIndex++ // skip closing ---
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

    // Regular prose line
    proseBuffer.push(line)
    lineIndex++
  }

  // Flush remaining
  if (inCodeFence) flushCodeFence()
  flushProse()

  return computeHashes(root)
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

function parseInlineElements(
  text: string,
  cfg: ContentTreeConfig
): TreeNode[] {
  // For group-level depth, just return a single prose node
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

  // Element-level: split on links, inline code, images, HTML tags
  const elements: TreeNode[] = []
  const remaining = text
  let idx = 0

  INLINE_RE.lastIndex = 0

  let lastEnd = 0
  let inlineMatch

  while ((inlineMatch = INLINE_RE.exec(remaining)) !== null) {
    if (inlineMatch.index > lastEnd) {
      const prose = remaining.slice(lastEnd, inlineMatch.index).trim()
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

    if (inlineMatch[1] !== undefined) {
      // Inline code
      elements.push(
        createNode({
          id: `inline-code:${idx++}`,
          nodeType: "element",
          contentType: "inert",
          elementType: "inline-code",
          value: inlineMatch[1],
        })
      )
    } else if (inlineMatch[2] !== undefined || inlineMatch[3] !== undefined) {
      // Image
      elements.push(
        createNode({
          id: `image:${idx++}`,
          nodeType: "element",
          contentType: inlineMatch[2] ? "mixed" : "inert",
          elementType: "image",
          value: inlineMatch[2] || undefined,
          meta: { src: inlineMatch[3] },
        })
      )
    } else if (inlineMatch[4] !== undefined) {
      // Link
      elements.push(
        createNode({
          id: `link:${idx++}`,
          nodeType: "element",
          contentType: "mixed",
          elementType: "link",
          value: inlineMatch[4],
          meta: { href: inlineMatch[5] },
        })
      )
    } else if (inlineMatch[6] !== undefined) {
      // HTML tag -- parse attributes into meta
      const tagAttrs = parseInlineAttrs(inlineMatch[7] || "")
      elements.push(
        createNode({
          id: `html-tag:${idx++}`,
          nodeType: "element",
          contentType: inlineMatch[8] ? "mixed" : "inert",
          elementType: "html-tag",
          value: inlineMatch[8] || undefined,
          meta: { tagName: inlineMatch[6], ...tagAttrs },
        })
      )
    }

    lastEnd = inlineMatch.index + inlineMatch[0].length
  }

  if (lastEnd < remaining.length) {
    const prose = remaining.slice(lastEnd).trim()
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
