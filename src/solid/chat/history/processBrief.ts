export function extractProcessBrief(reasoning: string | undefined, limit = 72): string {
  if (!reasoning || limit < 1) return ""
  // Formatting a long thought on every streamed token must stay bounded.
  const plain = reasoning.slice(-2048)
    .replace(/^[\uDC00-\uDFFF]/u, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm, "")
    .replace(/^[ \t]*[-_*]{3,}[ \t]*$/gm, "")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-+*][ \t]+|\d+[.)][ \t]+)+/gm, "")
    .replace(/^[ \t]*\[[ xX]\][ \t]+/gm, "")
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, "$1")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/`+|\*\*|__|~~/g, "")
    .replace(/(^|[^\p{L}\p{N}])[*_]|[*_]($|[^\p{L}\p{N}])/gu, "$1$2")
  const sentences = plain
    .split(/(?<=[。！？!?])[ \t]*|(?<=\.)[ \t]+|\n+/u)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const latest = sentences.at(-1) ?? ""
  const characters = Array.from(latest)
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : latest
}
