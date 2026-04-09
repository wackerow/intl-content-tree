# intl-content-tree

Parse structured content (markdown, JSON) into hashable trees for incremental localization.

Given a source file and its derivatives (translations), determine exactly what changed and whether each change requires retranslation or can be propagated automatically.

## Install

```sh
npm install intl-content-tree
```

## How It Works

1. **Parse** a content file into a tree of nodes, each classified as translatable or inert
2. **Serialize** the tree as a manifest (compact JSON with content hashes)
3. **Diff** a new tree against a stored manifest to get a precise changeset
4. **Route** each change: translatable drift needs retranslation, inert drift can be copied

```
Source file  -->  [parse]  -->  Tree  -->  [serialize]  -->  Manifest
                                            |
New source   -->  [parse]  -->  Tree  -->  [diff]  -->  Changeset
                                                         |
                                          unchanged | inertDrift | translatableDrift
                                          added | removed | renamed | reordered
```

## Quick Start

```typescript
import { parseMarkdown, diff, serialize, deserialize } from "intl-content-tree"

// Parse the current source
const tree = parseMarkdown(sourceContent)

// Compare against a stored manifest
const oldTree = deserialize(storedManifest)
const changes = diff(oldTree, tree)

// Route changes
for (const entry of changes.inertDrift) {
  // URL or code changed -- copy from source to all translations
}

for (const entry of changes.translatableDrift) {
  // Prose changed -- send this section for retranslation
}

for (const entry of changes.added) {
  // New section -- translate from scratch
}

// Store the new manifest
const manifest = serialize(tree, "path/to/file.md")
```

## Parsers

### Markdown

Parses markdown/MDX into a tree using heading structure. Each heading creates a group node; content between headings becomes child elements.

```typescript
import { parseMarkdown } from "intl-content-tree"

const tree = parseMarkdown(content, {
  depth: "group",                    // "group" (default) or "element"
  translatableAttributes: ["title", "alt", "description"],
}, {
  headingIdPattern: /\{#([^}]+)\}/,  // custom heading ID syntax (default)
  proseFenceTags: ["md", "text"],    // code fences treated as translatable
})
```

**What gets classified:**

| Content | Classification | Example |
|---------|---------------|---------|
| Prose paragraphs | translatable | "This function returns a promise" |
| Heading labels | translatable (separate `labelHash`) | "Getting Started" |
| Link display text | translatable | `[click here](...)` |
| Image alt text | translatable | `![diagram of the flow](...)` |
| Code comments | translatable | `// Initialize the connection` |
| Frontmatter fields | per config | `title:` translatable, `lang:` inert |
| URLs and paths | inert | `https://example.com` |
| Code bodies | inert | `const x = 1` |
| Component attributes | per config | `title=` translatable, `href=` inert |
| ICU variables | inert | `{username}`, `{count, plural, ...}` |

### JSON

Parses JSON key-value files. Top-level keys become group IDs. Nested objects create sub-groups.

```typescript
import { parseJson } from "intl-content-tree"

const tree = parseJson(content, {
  depth: "group",
  translatableAttributes: ["title", "alt"],
}, {
  markdownValueDetector: (key, value) => value.includes("\n") && /\[.+\]\(.+\)/.test(value),
})
```

String values containing HTML, markdown, or ICU MessageFormat variables (`{name}`, `{count, plural, ...}`) are detected and decomposed automatically. URLs and variable names are classified as inert; prose between them is translatable.

## Diff Engine

Compares two trees and classifies every change:

| Classification | Meaning | Action |
|---------------|---------|--------|
| `unchanged` | No changes | Nothing (check `labelHashChanged` for heading-only edits) |
| `inertDrift` | Only URLs, code, or paths changed | Copy from source -- no translation needed |
| `structuralDrift` | Nodes added/removed but no prose text changed | Propagate structure -- no translation needed |
| `translatableDrift` | Prose or translatable content changed | Retranslate this section |
| `added` | New group not in old tree | Translate from scratch |
| `removed` | Group no longer in source | Remove from translations |
| `renamed` | Same content, different ID | Update ID in translations |
| `reordered` | Same content, different position | Reorder in translations |

### Three-Hash Model

Each group node carries three hashes:

- **`contentHash`**: hash of translatable body content (prose, links, images)
- **`anchorHash`**: hash of inert content (URLs, code, paths)
- **`labelHash`**: hash of the group label (heading text in markdown, key name in JSON)

This separation enables precise change detection:

```typescript
const changes = diff(oldTree, newTree)

// Heading text changed, body unchanged
const headingOnly = changes.unchanged.filter(e => e.labelHashChanged)

// Body changed (needs retranslation)
const bodyChanged = changes.translatableDrift

// URL changed (scriptable copy, no retranslation)
const urlChanged = changes.inertDrift
```

## Validation

Check how well a tree supports incremental tracking:

```typescript
import { validate } from "intl-content-tree"

const result = validate(tree)
// {
//   totalSections: 15,
//   stableIds: 12,
//   autoSlugs: 3,
//   duplicateIds: [],
//   coverage: 80
// }
```

### Stable Identifiers

The effectiveness of incremental tracking depends on stable, explicit identifiers for content groups.

**For markdown**, this means custom heading IDs:

```markdown
## Getting Started {#getting-started}

Content here...

## Installation {#installation}

More content...
```

Without explicit `{#id}` anchors, IDs are auto-generated from heading text (e.g., `_auto:getting-started`). These break when headings are edited and cannot match across languages (translations produce different slugs).

| ID strategy | Rename detection | Cross-language matching | Heading edits |
|------------|-----------------|----------------------|---------------|
| Explicit `{#id}` | Yes | Yes | Stable |
| Auto-slug from text | No | No | Breaks key |
| Position-based | No | No | Breaks on insert/remove |

**For JSON**, keys naturally serve as stable identifiers.

## Utilities

```typescript
import { getInertValue, getNodeByPath, hasChanges, walk } from "intl-content-tree"

// Get an inert value by path (e.g., a URL for propagation)
const url = getInertValue(tree, "getting-started/link:0")

// Find a node by path
const node = getNodeByPath(tree, "installation/prose:0")

// Quick check: did anything change?
if (hasChanges(tree, storedManifest)) {
  // Run full diff...
}

// Iterate all nodes
for (const node of walk(tree)) {
  console.log(node.id, node.contentType)
}
```

## Serialization

Trees serialize to compact manifests for storage:

```typescript
import { serialize, deserialize } from "intl-content-tree"

const manifest = serialize(tree, "docs/getting-started.md")
// {
//   version: 1,
//   sourceFile: "docs/getting-started.md",
//   generatedAt: "2026-04-04T...",
//   rootHash: "a1b2c3d4e5f6",
//   tree: { contentHash, anchorHash, labelHash?, children, childrenOrder }
// }

const restored = deserialize(manifest)
```

Manifests use `childrenOrder` arrays to preserve sequence (object key order is not guaranteed in JSON).

## What This Package Does NOT Do

- Does not translate anything
- Does not call any AI/LLM APIs
- Does not handle file I/O (caller provides content as strings)
- Does not enforce heading IDs (supports explicit and auto-generated)
- Does not know about any specific project's components or schema

## License

MPL-2.0
