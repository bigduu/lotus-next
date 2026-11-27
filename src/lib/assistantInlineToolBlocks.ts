const CALL_OPEN = "<tool_call>"
const CALL_CLOSE = "</tool_call>"
const FUNCTION_OPEN = "<function="
const FUNCTION_CLOSE = "</function>"
const PARAMETER_OPEN = "<parameter="

type ToolBlock = { start: number; end: number; name?: string }

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

  // Match fenced and inline code delimiters before looking for tool markup.
  const tokens = /^(?: {0,3}>[ \t]?)* {0,3}(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})([^\r\n]*)|(`+)|\\[\\`<]|<(?:tool_call(?=>|$)|function(?:=|$))/gm
  let fence = ""
  let lineEnd = -1
  let indentedCode = false
  for (let token; (token = tokens.exec(source));) {
    const [value, delimiter, tail, ticks] = token
    if (fence) {
      if (delimiter?.[0] === fence[0] && delimiter.length >= fence.length && !tail?.trim()) fence = ""
      continue
    }
    if (delimiter && (delimiter[0] === "~" || !tail?.includes("`"))) {
      fence = delimiter
      continue
    }
    const backticks = delimiter ?? ticks
    if (backticks) {
      const offset = tokens.lastIndex - (tail?.length ?? 0)
      tokens.lastIndex = inlineCodeEnd(source, offset, backticks.length, streaming)
      continue
    }
    if (value.startsWith("\\")) continue
    if (token.index > lineEnd) {
      const lineBreak = source.indexOf("\n", token.index)
      lineEnd = lineBreak === -1 ? source.length : lineBreak
      const lineStart = source.lastIndexOf("\n", token.index - 1) + 1
      const prefix = source.slice(lineStart, token.index).replace(/^(?: {0,3}>[ \t]?)+/, "")
      indentedCode = /^(?: {4}| {0,3}\t)/.test(prefix)
    }
    if (indentedCode) continue

    const block = readToolBlock(source, token.index, streaming)
    if (block) {
      tokens.lastIndex = block.end
      yield block
    }
  }
}
