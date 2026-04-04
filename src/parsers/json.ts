import type {
  TreeNode,
  ContentTreeConfig,
  JsonParserConfig,
} from "../core/types.js"
import { DEFAULT_CONFIG, DEFAULT_JSON_CONFIG } from "../core/types.js"
import { normalizeForHash } from "../core/hash.js"
import { createNode, computeHashes } from "../core/tree.js"
import { parseMarkdown } from "./markdown.js"

/**
 * Parse a JSON string into a TreeNode tree.
 *
 * Top-level keys become section IDs. Nested objects create sub-sections.
 * String values containing markdown are optionally parsed recursively.
 */
export function parseJson(
  content: string,
  config?: Partial<ContentTreeConfig>,
  parserConfig?: Partial<JsonParserConfig>
): TreeNode {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const pcfg = { ...DEFAULT_JSON_CONFIG, ...parserConfig }

  const data = JSON.parse(content) as Record<string, unknown>

  const root = createNode({
    id: "root",
    nodeType: "root",
    contentType: "mixed",
    elementType: "root",
  })

  root.children = parseObject(data, cfg, pcfg)
  return computeHashes(root)
}

function parseObject(
  obj: Record<string, unknown>,
  cfg: ContentTreeConfig,
  pcfg: JsonParserConfig
): TreeNode[] {
  const nodes: TreeNode[] = []

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue

    if (typeof value === "object" && !Array.isArray(value)) {
      // Nested object -> section node
      const section = createNode({
        id: key,
        nodeType: "section",
        contentType: "mixed",
        elementType: "section",
        children: parseObject(
          value as Record<string, unknown>,
          cfg,
          pcfg
        ),
      })
      nodes.push(section)
    } else if (typeof value === "string") {
      // Check for markdown-in-value
      if (pcfg.markdownValueDetector?.(key, value)) {
        const mdTree = parseMarkdown(value, cfg)
        nodes.push(
          createNode({
            id: key,
            nodeType: "element",
            contentType: "mixed",
            elementType: "json-value",
            meta: { containsMarkdown: "true" },
            children: mdTree.children,
          })
        )
      } else if (containsHtml(value)) {
        // HTML in value -- mixed content
        nodes.push(
          createNode({
            id: key,
            nodeType: "element",
            contentType: "mixed",
            elementType: "json-value",
            value: normalizeForHash(value),
            meta: { containsHtml: "true" },
          })
        )
      } else {
        // Plain string value -- translatable
        nodes.push(
          createNode({
            id: key,
            nodeType: "element",
            contentType: "translatable",
            elementType: "json-value",
            value: value,
          })
        )
      }
    } else if (Array.isArray(value)) {
      // Arrays: each element as a child
      const section = createNode({
        id: key,
        nodeType: "section",
        contentType: "mixed",
        elementType: "section",
      })
      value.forEach((item, i) => {
        if (typeof item === "string") {
          section.children.push(
            createNode({
              id: `${i}`,
              nodeType: "element",
              contentType: "translatable",
              elementType: "json-value",
              value: item,
            })
          )
        } else if (typeof item === "object" && item !== null) {
          const itemNode = createNode({
            id: `${i}`,
            nodeType: "section",
            contentType: "mixed",
            elementType: "section",
            children: parseObject(
              item as Record<string, unknown>,
              cfg,
              pcfg
            ),
          })
          section.children.push(itemNode)
        }
      })
      nodes.push(section)
    } else {
      // Numbers, booleans -- inert
      nodes.push(
        createNode({
          id: key,
          nodeType: "element",
          contentType: "inert",
          elementType: "json-value",
          value: String(value),
        })
      )
    }
  }

  return nodes
}

function containsHtml(value: string): boolean {
  return /<[a-zA-Z][\w-]*[\s>]/.test(value)
}
