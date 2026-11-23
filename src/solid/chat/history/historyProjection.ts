import { runtimeNoticeFromMetadata } from "@/components/chat/runtimeNotices"
import { isCompletedAnswerHandoff } from "@/lib/completedAnswerHandoff"
import { messageOccurrenceKey, type Message } from "@shared/types/chatMessages"

import type { createUiText } from "../../shell/uiText"
import type { LiveSegment } from "../createChat"

type Text = ReturnType<typeof createUiText>

function liveToolMessages(seg: Extract<LiveSegment, { kind: "tools" }>, text: Text): Message[] {
  const out: Message[] = []
  for (const c of seg.calls) {
    out.push({
      id: `live-call-${c.toolCallId}`,
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: c.toolCallId, toolName: c.toolName, parameters: c.args ?? {} }],
      createdAt: "",
    })
    if (c.output || c.images?.length || c.status !== "running") {
      out.push({
        id: `live-res-${c.toolCallId}`,
        role: "assistant",
        type: "tool_result",
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        isError: c.status === "error",
        result: { tool_name: c.toolName, display_preference: "Default", result: c.status === "error" ? c.error || c.output : c.output },
        images: c.images?.map((image, index) => ({
          id: `${c.toolCallId}-image-${index}`,
          base64: image.data,
          type: image.mime_type,
          name: text("tool_image_7b8fcc11", { v0: index + 1 }),
          size: 0,
        })),
        createdAt: "",
      })
    }
  }
  return out
}

export function messageText(m: Message): string {
  if ("content" in m && typeof (m as { content?: unknown }).content === "string") {
    return (m as { content: string }).content
  }
  if ("displayText" in m && typeof (m as { displayText?: unknown }).displayText === "string") {
    return (m as { displayText: string }).displayText
  }
  return ""
}

export function messageRuntimeNotice(m: Message, text = messageText(m)) {
  if (m.role !== "assistant") return null
  return runtimeNoticeFromMetadata("metadata" in m ? m.metadata : undefined, text)
}

function isToolMessage(m: Message): boolean {
  const t = (m as { type?: string }).type
  return t === "tool_call" || t === "tool_result"
}

function messageReasoning(m: Message): string {
  const r = (m as { metadata?: { reasoning?: unknown } }).metadata?.reasoning
  return typeof r === "string" ? r : ""
}

export type ProcessPart =
  | { kind: "reasoning"; text: string; createdAt?: string }
  | { kind: "tools"; items: Message[]; runningCallIds?: ReadonlySet<string> }
export type ProcessItem = {
  kind: "process"
  key: string
  parts: ProcessPart[]
  active?: boolean
  thinking?: boolean
  status?: string | null
}
/** A finished turn's folded middle: processes and intermediate bodies hide
 *  behind one divider so only the final conclusion stays in reading flow. */
export type TurnCollapseItem = {
  kind: "collapsedTurn"
  key: string
  items: RenderItem[]
  lastIndex: number
  toolCalls: number
  startedAt: number | null
  finishedAt: number | null
}
export type RenderItem = { kind: "msg"; m: Message; streaming?: boolean } | ProcessItem
export type DisplayItem = RenderItem | TurnCollapseItem

function appendProcessPart(items: RenderItem[], key: string, part: ProcessPart): ProcessItem {
  const previous = items.at(-1)
  const process = previous?.kind === "process"
    ? previous
    : { kind: "process" as const, key: `activity-${key}`, parts: [] }
  if (process !== previous) items.push(process)
  const lastPart = process.parts.at(-1)
  if (lastPart?.kind === "tools" && part.kind === "tools") {
    lastPart.items.push(...part.items)
    if (part.runningCallIds) lastPart.runningCallIds = new Set([
      ...(lastPart.runningCallIds ?? []), ...part.runningCallIds,
    ])
  } else process.parts.push(part)
  return process
}

// Only visible messages interrupt an activity. Reasoning attached to a body
// belongs to the activity immediately before that body, just as it does live.
export function buildRenderItems(messages: readonly Message[]): RenderItem[] {
  const out: RenderItem[] = []
  for (const m of messages) {
    if (m.role === "system") continue
    if (isToolMessage(m)) {
      appendProcessPart(out, messageOccurrenceKey(m), { kind: "tools", items: [m] })
    } else {
      const reasoning = m.role === "assistant" ? messageReasoning(m) : ""
      if (reasoning.trim()) appendProcessPart(out, messageOccurrenceKey(m), { kind: "reasoning", text: reasoning, createdAt: m.createdAt })
      const images = (m as { images?: unknown[] }).images
      if (messageText(m).trim() || images?.length) out.push({ kind: "msg", m })
    }
  }
  return out
}

export function buildLiveItems(
  segments: readonly LiveSegment[],
  answer: string | null,
  reasoning: string | null,
  active: boolean,
  status: string | null,
  text: Text,
): RenderItem[] {
  const out: RenderItem[] = []
  let bodyIndex = 0
  const appendText = (body: string, thought: string | null, streaming = false) => {
    if (thought?.trim()) appendProcessPart(out, `live-${bodyIndex}`, { kind: "reasoning", text: thought })
    if (!body.trim()) return
    out.push({ kind: "msg", streaming, m: {
      id: `live-body-${bodyIndex++}`, role: "assistant", type: "text", content: body, createdAt: "",
    } })
  }
  for (const segment of segments) {
    if (segment.kind === "text") appendText(segment.text, segment.reasoning)
    else if (segment.calls.length) appendProcessPart(out, `live-${bodyIndex}`, {
      kind: "tools", items: liveToolMessages(segment, text),
      runningCallIds: new Set(segment.calls.filter((call) => call.status === "running").map((call) => call.toolCallId)),
    })
  }
  appendText(answer ?? "", reasoning, active)
  if (active && (!answer?.trim() || status)) {
    const last = out.at(-1)
    // Admission displays Thinking without an empty disclosure; real records
    // turn this same stable row into an inspectable process.
    const process: ProcessItem = last?.kind === "process" ? last : {
      kind: "process", key: `activity-live-${bodyIndex}`, parts: [],
    }
    if (process !== last) out.push(process)
    process.active = true
    const running = process.parts.some((part) => part.kind === "tools" && part.runningCallIds?.size)
    process.thinking = !answer?.trim() && !running && !status?.trim()
    process.status = status
  }
  return out
}

export function itemTimestamp(item: RenderItem, edge: "first" | "last" = "first"): number | null {
  const timestamps = item.kind === "msg" ? [item.m.createdAt] : item.parts.flatMap((part) =>
    part.kind === "tools" ? part.items.map((message) => message.createdAt) : [part.createdAt],
  )
  const ordered = edge === "first" ? timestamps : [...timestamps].reverse()
  for (const value of ordered) {
    const timestamp = Date.parse(String(value || ""))
    if (Number.isFinite(timestamp)) return timestamp
  }
  return null
}

export function formatElapsedDuration(durationMs: number, text: Text): string | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return text("h_69c6dc51", { v0: hours, v1: minutes > 0 ? text("m_977a465a", { v0: minutes, v1: "" }) : "" })
  if (minutes > 0) return text("m_977a465a", { v0: minutes, v1: seconds > 0 ? text("s_6366b823", { v0: seconds }) : "" })
  return text("s_6366b823", { v0: seconds })
}

function isFinalAssistantResponse(item: RenderItem | undefined): item is Extract<RenderItem, { kind: "msg" }> {
  if (item?.kind !== "msg" || item.m.role !== "assistant") return false
  if (item.m.type === "text" && item.m.phase === "commentary") return false
  const images = (item.m as { images?: unknown[] }).images
  return Boolean(messageText(item.m).trim() || images?.length)
}

function isRecordedFinal(item: DisplayItem | undefined): boolean {
  return item?.kind === "msg" && item.m.role === "assistant" && item.m.type === "text"
    && item.m.phase === "final_answer"
}

/** Fold a completed turn's middle behind one divider. Runs only for turns whose
 *  final summary is already on the record (a later item exists or the run is not
 *  live), so the streaming loop keeps every intermediate visible as it happens. */
export function buildDisplayItems(
  items: RenderItem[],
  collapseLastTurn: boolean,
): DisplayItem[] {
  const collapses = new Map<number, TurnCollapseItem>()
  let boundary = 0
  for (let index = 0; index <= items.length; index += 1) {
    const next = items[index]
    const nextIsUser = next?.kind === "msg" && next.m.role === "user"
    const summary = index - 1
    const conclusion = items[summary]
    // Background wait notices can carry a final phase in persisted history.
    const runtimeNotice = conclusion?.kind === "msg" && messageRuntimeNotice(conclusion.m)
    const recorded = summary >= 0 && !runtimeNotice && isRecordedFinal(conclusion)
    if (next && !nextIsUser && !recorded) continue

    const first = boundary + 1
    boundary = nextIsUser ? index : summary
    // A committed answer closes its own reply even if an internal wake
    // started another reply without adding a visible user message.
    if (summary < first || runtimeNotice || !isFinalAssistantResponse(conclusion)) continue
    if (!next && !collapseLastTurn && !recorded) continue
    const indexes: number[] = []
    for (let itemIndex = first; itemIndex < summary; itemIndex += 1) indexes.push(itemIndex)
    if (!indexes.some((itemIndex) => items[itemIndex].kind === "process")) continue
    const timestamps = indexes.flatMap((index) => {
      const item = items[index]
      return item.kind === "msg" ? [item.m.createdAt] : item.parts.flatMap((part) =>
        part.kind === "tools" ? part.items.map((message) => message.createdAt) : [part.createdAt])
    })
    const startedAt = timestamps.map((value) => Date.parse(value || "")).find(Number.isFinite)
    const finishedAt = [...timestamps].reverse().map((value) => Date.parse(value || "")).find(Number.isFinite)
    collapses.set(first, {
      kind: "collapsedTurn",
      key: `collapsed-turn-${messageOccurrenceKey(conclusion.m)}`,
      items: indexes.map((index) => items[index]),
      lastIndex: summary - 1,
      toolCalls: toolCallCount(items.slice(first, summary)),
      startedAt: startedAt ?? null,
      finishedAt: finishedAt ?? null,
    })
  }
  if (!collapses.size) return items
  const out: DisplayItem[] = []
  for (let index = 0; index < items.length; index += 1) {
    const collapse = collapses.get(index)
    if (collapse) {
      out.push(collapse)
      index = collapse.lastIndex
      continue
    }
    out.push(items[index])
  }
  return out
}

export function toolCallCount(items: RenderItem[]): number {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.kind !== "process") continue
    for (const message of item.parts.flatMap((part) => part.kind === "tools" ? part.items : [])) {
      for (const call of (message as { toolCalls?: { toolCallId?: string }[] }).toolCalls ?? []) {
        if (call.toolCallId) ids.add(call.toolCallId)
      }
    }
  }
  return ids.size
}

export function renderItemKey(item: DisplayItem): string {
  if (item.kind === "msg") return `message-${messageOccurrenceKey(item.m)}`
  return item.key
}

export interface MessageHistoryEntry {
  key: string
  item: DisplayItem
}

export const buildHistoryEntries = (items: DisplayItem[]): MessageHistoryEntry[] =>
  items.map((item) => ({ key: renderItemKey(item), item }))

export function sideChatSourceText(message: Message): string {
  if (message.role === "system" || isToolMessage(message) || isCompletedAnswerHandoff(message) || messageRuntimeNotice(message)) return ""
  return messageText(message).trim()
}

/** Actions belong to stored user rows and standalone final assistant replies. */
export function collectMessageActions(entries: readonly MessageHistoryEntry[], includeTrailing: boolean) {
  const targets = new Map<string, Message>()
  let candidate: MessageHistoryEntry | undefined
  const add = (entry: MessageHistoryEntry | undefined) => {
    if (!entry || entry.item.kind !== "msg") return
    const { m: message } = entry.item
    if (message.role === "system" || isToolMessage(message) || isCompletedAnswerHandoff(message) || messageRuntimeNotice(message)) return
    const images = "images" in message ? message.images : undefined
    if (messageText(message).trim() || images?.length) targets.set(entry.key, message)
  }
  for (const entry of entries) {
    const { item } = entry
    if (item.kind !== "msg") continue
    if (item.m.role === "user") {
      add(candidate)
      add(entry)
      candidate = undefined
    } else if (isRecordedFinal(item)) {
      add(entry)
      candidate = undefined
    } else if (isFinalAssistantResponse(item)) {
      candidate = entry
    }
  }
  if (includeTrailing) add(candidate)
  return targets
}

/** A multi-answer turn has no single supported regenerate target. */
export function findRegenerationKey(entries: readonly MessageHistoryEntry[]): string | null {
  const tail = entries.at(-1)
  if (!tail || tail.item.kind !== "msg" || !isFinalAssistantResponse(tail.item) || messageRuntimeNotice(tail.item.m)
    || isCompletedAnswerHandoff(tail.item.m)) return null
  for (let index = entries.length - 2; index >= 0; index--) {
    const item = entries[index].item
    if (item.kind === "msg" && item.m.role === "user") return tail.key
    if (isRecordedFinal(item)) return null
  }
  return null
}

export function collectSideChatSourceKeys(entries: readonly MessageHistoryEntry[], includeTrailing: boolean): Set<string> {
  const keys = new Set<string>()
  for (const [key, message] of collectMessageActions(entries, includeTrailing)) {
    if (sideChatSourceText(message)) keys.add(key)
  }
  return keys
}

/** Quotes can address stored rows folded into another virtual entry. */
export function findSideChatSourceEntry(entries: readonly MessageHistoryEntry[], id: string): MessageHistoryEntry | undefined {
  const matches = (item: RenderItem) => item.kind === "msg" && item.m.id === id && Boolean(sideChatSourceText(item.m))
  return entries.find(({ item }) => item.kind === "collapsedTurn" ? item.items.some(matches) : matches(item))
}
