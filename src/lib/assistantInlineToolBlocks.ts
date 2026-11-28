const CALL_OPEN = "<tool_call>"
const CALL_CLOSE = "</tool_call>"
const FUNCTION_OPEN = "<function="
const FUNCTION_CLOSE = "</function>"
const PARAMETER_OPEN = "<parameter="

type ToolBlock = { start: number; end: number; name?: string }
type FenceContainer = { kind: "quote" } | { kind: "list"; padding: string }

function fenceContainers(prefix: string): FenceContainer[] | null {
  const container = / {0,3}(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+)/y
  const containers: FenceContainer[] = []
  let offset = 0
  for (let match; (match = container.exec(prefix));) {
    const marker = match[0]
    containers.push(marker.trimStart().startsWith(">")
      ? { kind: "quote" }
      : { kind: "list", padding: " ".repeat(marker.length) })
    offset = container.lastIndex
  }
  return /^ {0,3}$/.test(prefix.slice(offset)) ? containers : null
}

function fencedCodeEnd(source: string, offset: number, delimiter: string, containers: FenceContainer[]): number {
  const lines = /(?:\r\n?|\n)([^\r\n]*)/g
  lines.lastIndex = offset
  for (let line; (line = lines.exec(source));) {
    let content = line[1]!
    const start = lines.lastIndex - content.length
    // Remove only the opener's containers. Extra quote or list markers belong
    // to the code, while the container ending implicitly closes its fence.
    for (const container of containers) {
      if (container.kind === "list") {
        if (!content.startsWith(container.padding) && content.trim()) return start
        content = content.slice(container.padding.length)
        continue
      }
      const quote = /^ {0,3}>[ \t]?/.exec(content)
      if (!quote) return start
      content = content.slice(quote[0].length)
    }
    const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(content)?.[1]
    if (close?.[0] === delimiter[0] && close.length >= delimiter.length) return lines.lastIndex
  }
  return source.length
}

function inlineCodeEnd(source: string, offset: number, length: number, streaming: boolean): number {
  // An inline code span can cross a line break within its paragraph.
  const boundary = /`+|\r?\n(?=[ \t]*(?:\r?$|(?:>[ \t]*)*(?:`{3,}|~{3,})))/gm
  boundary.lastIndex = offset
  for (let match; (match = boundary.exec(source));) {
    if (match[0][0] !== "`") return offset
    if (match[0].length === length) return boundary.lastIndex
  }
  return streaming ? source.length : offset
}

function findToolClose(source: string, offset: number): RegExpExecArray | null {
  const tags = /<parameter=|<\/(?:function|tool_call)>/g
  // Parameter values are literal text. Only a closing parameter tag followed
  // by another protocol delimiter takes us back outside the value.
  const parameterEnd = /<\/parameter>(?=\s*(?:<parameter=|<\/(?:function|tool_call)>))/g
  tags.lastIndex = offset
  for (let tag; (tag = tags.exec(source));) {
    if (tag[0] !== PARAMETER_OPEN) return tag
    parameterEnd.lastIndex = tags.lastIndex
    if (!parameterEnd.test(source)) return null
    tags.lastIndex = parameterEnd.lastIndex
  }
  return null
}

function readToolBlock(source: string, start: number, streaming: boolean): ToolBlock | null {
  const wrapped = source.startsWith(CALL_OPEN, start)
  const header = source.slice(start + (wrapped ? CALL_OPEN.length : 0)).trimStart()
  const opening = /^<function=([\w./:-]+)>/.exec(header)
  if (!opening) {
    const partialFunction = FUNCTION_OPEN.startsWith(header) || /^<function=[\w./:-]*$/.test(header)
    return streaming && (partialFunction || header === "<tool_call")
      ? { start, end: source.length }
      : null
  }

  const bodyOffset = source.length - header.length + opening[0].length
  const body = source.slice(bodyOffset).trimStart()
  const delimiters = [PARAMETER_OPEN, FUNCTION_CLOSE, CALL_CLOSE]
  // Bare tags also occur in prose about tools. Require a body delimiter.
  if (!wrapped && !delimiters.some((delimiter) =>
    body.startsWith(delimiter) || (streaming && delimiter.startsWith(body)))) return null

  const close = findToolClose(source, bodyOffset)
  let end = close ? close.index + close[0].length : source.length
  if (close?.[0] === FUNCTION_CLOSE) {
    const tail = source.slice(end).trimStart()
    if (tail.startsWith(CALL_CLOSE)) end = source.length - tail.length + CALL_CLOSE.length
    else if (streaming && wrapped && tail && CALL_CLOSE.startsWith(tail)) end = source.length
  }
  return { start, end, name: opening[1]! }
}

export function* findInlineToolBlocks(source: string, streaming: boolean): Generator<ToolBlock> {
  if (!source.includes("<function") && !source.includes("<tool_call")) return

  const tokens = /(`+)|(~{3,})|\\[\\`<]|<(?:tool_call(?=>|$)|function(?:=|$))/gm
  const lineBreaks = /\r\n?|\n/g
  let lineEnd = -1
  let indentedCode = false
  for (let token; (token = tokens.exec(source));) {
    const [value, backticks, tildes] = token
    if (token.index > lineEnd) {
      let lineStart = lineBreaks.lastIndex
      let lineBreak = lineBreaks.exec(source)
      while (lineBreak && lineBreak.index < token.index) {
        lineStart = lineBreaks.lastIndex
        lineBreak = lineBreaks.exec(source)
      }
      lineEnd = lineBreak?.index ?? source.length
      const prefix = source.slice(lineStart, token.index)
      const relativePrefix = prefix.replace(/^(?: {0,3}>[ \t]?)+/, "")
      indentedCode = /^(?: {4}| {0,3}\t)/.test(relativePrefix)

      const delimiter = backticks ?? tildes
      if (delimiter && delimiter.length >= 3) {
        const containers = fenceContainers(prefix)
        if (containers && (tildes || !source.slice(tokens.lastIndex, lineEnd).includes("`"))) {
          tokens.lastIndex = fencedCodeEnd(source, lineEnd, delimiter, containers)
          continue
        }
      }
    }
    if (indentedCode || tildes || value.startsWith("\\")) continue
    if (backticks) {
      tokens.lastIndex = inlineCodeEnd(source, tokens.lastIndex, backticks.length, streaming)
      continue
    }

    const block = readToolBlock(source, token.index, streaming)
    if (block) {
      tokens.lastIndex = block.end
      yield block
    }
  }
}
