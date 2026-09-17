# Changelog

## 0.4.0

**Manifest schema version 2. Stored v1 manifests must be re-derived.**

- Frontmatter is parsed with a real YAML parser (`yaml`, the package's first runtime dependency) instead of a single-line `key: value` scan
- Sequences and mappings become section nodes with one child per item/subkey, so adding, removing, rewriting, or reordering an item moves the field hash and the root hash -- previously a block sequence hashed as an empty value and every edit to it was invisible
- Flow (`tags: ["a", "b"]`) and block spellings of the same sequence hash identically
- A sequence item containing a colon (`- "AI Agents: Luna"`) is no longer misparsed as a key of its own
- Multi-line scalars (`>`, `|`, `>-`, `|-`) resolve to their folded/literal text
- Scalars are kept as written: quotes stripped, trailing comments dropped, dates, numbers, and booleans never re-serialized
- Invalid YAML falls back to the previous line-based parse and sets `meta.frontmatterParseError = "true"` on the root node
- Frontmatter section nodes are excluded from `validate()` counts and from `getContainingSection()`

Hash compatibility: files whose frontmatter is only plain, unquoted, comment-free single-line scalars keep their v1 hashes. Every other file moves.

## 0.3.2

- Parse multi-line JSX opening tags so their translatable attributes are extracted

## 0.3.1

- Detect indented block components (e.g. `<Card />` nested inside `<Grid>`)

## 0.3.0

- Add `extractChanges`, a Merkle tree walk that reports per-node updates, additions, removals, relocations, and section renames

## 0.2.2

- Compare hash sets when classifying `structuralDrift`

## 0.2.1

- Classify drift using the new tree's `contentType` (deserialized trees lose it)

## 0.2.0

- Add the `structuralDrift` classification for nodes added/removed without prose changes
- Remove `extractInertChanges`

## 0.1.5

- Add `extractInertChanges` helper

## 0.1.4

- Decompose HTML and ICU variables inside JSON string values

## 0.1.3

- Omit empty children from manifests
- Hash meta values into `anchorHash`
- Parser fixes and integration tests
