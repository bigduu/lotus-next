export const REVEAL_CHUNK_SIZE = 32
export const MAX_REVEAL_CHUNKS = 256

type HastNode = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const SKIP_TAGS = new Set([
  "a", "code", "pre", "svg", "math", "annotation", "table", "button",
  "input", "textarea", "select", "kbd", "samp", "sup",
])
/** Only the existing sanitized HAST is decorated; Markdown parsing stays upstream. */
export function createRevealPlugin(name: string, revealFirstPass: boolean) {
  let committedText: string | null = revealFirstPass ? "" : null
  let pendingText = ""
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null

  const rehypeReveal = () => (tree: HastNode) => {
    type Leaf = { node: HastNode; parent: HastNode; index: number; start: number; safe: boolean }
    const leaves: Leaf[] = []
    let text = ""
    const visit = (parent: HastNode, skipped = false) => {
      const properties = parent.properties
      const skip = skipped || SKIP_TAGS.has(parent.tagName ?? "") ||
        properties?.ariaHidden === true || properties?.ariaHidden === "true" ||
        properties?.["aria-hidden"] === true || properties?.["aria-hidden"] === "true"
      parent.children?.forEach((node, index) => {
        if (node.type === "text") {
          leaves.push({ node, parent, index, start: text.length, safe: !skip })
          text += node.value ?? ""
        } else visit(node, skip)
      })
    }
    visit(tree)
    pendingText = text
    if (!segmenter) return

    // Grammar repairs/replacements may reparent old text. Fail closed on a
    // non-prefix revision; positional React keys alone cannot prevent replay.
    const prefix = committedText?.length ?? 0
    const canReveal = committedText !== null && text.startsWith(committedText)
    const finalLeaf = leaves.findLast((leaf) => leaf.node.value?.trim())
    let budget = MAX_REVEAL_CHUNKS
    const replacements = leaves.map((leaf) => {
      if (!leaf.safe || !leaf.node.value?.trim()) return null
      const chunks: { value: string; start: number; reveal: boolean }[] = []
      let value = ""
      let start = 0
      let length = 0
      for (const segment of segmenter.segment(leaf.node.value)) {
        if (length === REVEAL_CHUNK_SIZE && budget > 0) {
          chunks.push({ value, start, reveal: canReveal && leaf.start + start >= prefix })
          budget -= 1
          start += value.length
          value = ""
          length = 0
        }
        value += segment.segment
        length += 1
      }
      if (value) {
        chunks.push({ value, start, reveal: budget > 0 && canReveal && leaf.start + start >= prefix })
        budget = Math.max(0, budget - 1)
      }
      return chunks.map((chunk, index): HastNode => ({
        type: "element", tagName: "span",
        properties: {
          "data-assistant-reveal-chunk": "true",
          "data-assistant-reveal": chunk.reveal ? "true" : undefined,
          "data-assistant-reveal-tail": leaf === finalLeaf && index === chunks.length - 1 ? "true" : undefined,
        },
        children: [{ type: "text", value: chunk.value }],
      }))
    })
    // Reverse order keeps each original sibling index valid.
    for (let index = leaves.length - 1; index >= 0; index -= 1) {
      const replacement = replacements[index]
      const leaf = leaves[index]
      if (replacement) leaf.parent.children!.splice(leaf.index, 1, ...replacement)
    }
  }
  // Streamdown's processor cache uses plugin names, not function identity.
  Object.defineProperty(rehypeReveal, "name", { value: `assistantReveal${name}` })
  return { plugin: rehypeReveal, commit: () => { committedText = pendingText } }
}

