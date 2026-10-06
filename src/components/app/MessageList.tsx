import { uiText, useUiLocale } from "@shared/i18n/ui"
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react"
import {
  measureElement as measureVirtualElement,
  observeElementRect,
  useVirtualizer,
  type Rect,
  type Virtualizer,
} from "@tanstack/react-virtual"
import { Copy, Pencil, RotateCcw, GitFork, MoreHorizontal, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/ui/brand-mark"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { AssistantMarkdown } from "@/components/chat/AssistantMarkdown"
import { Reasoning } from "@/components/chat/Reasoning"
import { ToolCalls } from "@/components/chat/ToolCalls"
import { ProcessActivity } from "@/components/chat/ProcessActivity"
import { SubAgents } from "@/components/chat/SubAgents"
import { cn } from "@/lib/utils"
import type { Message } from "@shared/types/chatMessages"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import type { LiveSegment } from "@/hooks/useChat"

// Synthesize Message-shaped rows from a live tools segment so the in-run
// display reuses the exact ToolCalls rendering (grouping/expansion) that
// persisted history gets. While a call runs, its streamed output shows in the
// result slot and is replaced by the final result on completion.
function liveToolMessages(seg: Extract<LiveSegment, { kind: "tools" }>): Message[] {
  const out: Message[] = []
  for (const c of seg.calls) {
    out.push({
      id: `live-call-${c.toolCallId}`,
      role: "assistant",
      type: "tool_call",
      toolCalls: [{ toolCallId: c.toolCallId, toolName: c.toolName, parameters: c.args ?? {} }],
      createdAt: "",
    } as unknown as Message)
    if (c.output || c.images?.length || c.status !== "running") {
      out.push({
        id: `live-res-${c.toolCallId}`,
        role: "tool",
        type: "tool_result",
        toolCallId: c.toolCallId,
        isError: c.status === "error",
        result: { result: c.status === "error" ? c.error || c.output : c.output },
        images: c.images?.map((image, index) => ({
          id: `${c.toolCallId}-image-${index}`,
          base64: image.data,
          type: image.mime_type,
          name: uiText("tool_image_7b8fcc11", { v0: index + 1 }),
          size: 0,
        })),
        createdAt: "",
      } as unknown as Message)
    }
  }
  return out
}

function messageText(m: Message): string {
  if ("content" in m && typeof (m as { content?: unknown }).content === "string") {
    return (m as { content: string }).content
  }
  if ("displayText" in m && typeof (m as { displayText?: unknown }).displayText === "string") {
    return (m as { displayText: string }).displayText
  }
  return ""
}

function isToolMessage(m: Message): boolean {
  const t = (m as { type?: string }).type
  return t === "tool_call" || t === "tool_result"
}

function messageReasoning(m: Message): string {
  const r = (m as { metadata?: { reasoning?: unknown } }).metadata?.reasoning
  return typeof r === "string" ? r : ""
}

type ProcessPart =
  | { kind: "reasoning"; text: string; createdAt?: string }
  | { kind: "tools"; items: Message[]; runningCallIds?: ReadonlySet<string> }
type ProcessItem = {
  kind: "process"
  key: string
  parts: ProcessPart[]
  active?: boolean
  thinking?: boolean
  status?: string | null
}
type RenderItem = { kind: "msg"; m: Message; streaming?: boolean } | ProcessItem

type HistoryEntry = {
  key: string
  item: RenderItem
  itemIndex: number
}

const HISTORY_ROW_GAP = 8
const INITIAL_VIRTUAL_RECT = { width: 1024, height: 720 }

type HistoryVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>

function observeHistoryRect(instance: HistoryVirtualizer, callback: (rect: Rect) => void) {
  return observeElementRect(instance, (rect) => callback({
    width: rect.width || INITIAL_VIRTUAL_RECT.width,
    height: rect.height || INITIAL_VIRTUAL_RECT.height,
  }))
}

function measureHistoryElement(
  element: HTMLDivElement,
  entry: ResizeObserverEntry | undefined,
  instance: HistoryVirtualizer,
): number {
  const measured = measureVirtualElement(element, entry, instance)
  return measured > 0
    ? measured
    : instance.options.estimateSize(instance.indexFromElement(element))
}

const MESSAGE_SURFACE_LAYOUT =
  "max-w-[85%] overflow-hidden rounded-2xl px-3.5 py-2 [overflow-wrap:anywhere]"
const ASSISTANT_MESSAGE_SURFACE =
  "bg-transparent text-base font-normal leading-7 text-foreground"

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
function buildRenderItems(messages: Message[]): RenderItem[] {
  const out: RenderItem[] = []
  for (const m of messages) {
    if (m.role === "system") continue
    if (isToolMessage(m)) {
      appendProcessPart(out, m.id, { kind: "tools", items: [m] })
    } else {
      const reasoning = m.role === "assistant" ? messageReasoning(m) : ""
      if (reasoning.trim()) appendProcessPart(out, m.id, { kind: "reasoning", text: reasoning, createdAt: m.createdAt })
      const images = (m as { images?: unknown[] }).images
      if (messageText(m).trim() || images?.length) out.push({ kind: "msg", m })
    }
  }
  return out
}

function buildLiveItems(
  segments: LiveSegment[],
  text: string | null,
  reasoning: string | null,
  active: boolean,
  status: string | null,
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
      kind: "tools", items: liveToolMessages(segment),
      runningCallIds: new Set(segment.calls.filter((call) => call.status === "running").map((call) => call.toolCallId)),
    })
  }
  appendText(text ?? "", reasoning, active)
  if (active && (!text?.trim() || status)) {
    const last = out.at(-1)
    // Admission displays Thinking without an empty disclosure; real records
    // turn this same stable row into an inspectable process.
    const process: ProcessItem = last?.kind === "process" ? last : {
      kind: "process", key: `activity-live-${bodyIndex}`, parts: [],
    }
    if (process !== last) out.push(process)
    process.active = true
    const running = process.parts.some((part) => part.kind === "tools" && part.runningCallIds?.size)
    process.thinking = !text?.trim() && !running && !status?.trim()
    process.status = status
  }
  return out
}

function itemTimestamp(item: RenderItem, edge: "first" | "last" = "first"): number | null {
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

function formatElapsedDuration(durationMs: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return uiText("h_69c6dc51", { v0: hours, v1: minutes > 0 ? uiText("m_977a465a", { v0: minutes, v1: "" }) : "" })
  if (minutes > 0) return uiText("m_977a465a", { v0: minutes, v1: seconds > 0 ? uiText("s_6366b823", { v0: seconds }) : "" })
  return uiText("s_6366b823", { v0: seconds })
}

function isFinalAssistantResponse(item: RenderItem): boolean {
  if (item.kind !== "msg" || item.m.role !== "assistant") return false
  const images = (item.m as { images?: unknown[] }).images
  return Boolean(messageText(item.m).trim() || images?.length)
}

function buildActionableAssistantIndexes(
  items: RenderItem[],
  includeTrailingAssistant: boolean,
): Set<number> {
  const indexes = new Set<number>()
  let candidate: number | null = null

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item.kind === "msg" && item.m.role === "user") {
      if (candidate !== null) indexes.add(candidate)
      candidate = null
      continue
    }
    if (isFinalAssistantResponse(item)) candidate = index
  }

  if (includeTrailingAssistant && candidate !== null) indexes.add(candidate)
  return indexes
}

function toolCallCount(items: RenderItem[]): number {
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

function renderItemKey(item: RenderItem, index: number): string {
  if (item.kind === "msg") return `message-${item.m.id}`
  return item.key || `activity-${index}`
}

function findSpawnItemIndex(items: RenderItem[]): number {
  return items.findLastIndex((item) => item.kind === "process" && item.parts.some((part) =>
    part.kind === "tools" && part.items.some((message) =>
      (message as { toolCalls?: { toolName?: string }[] }).toolCalls?.some((call) =>
        /task|sub.?agent|spawn/i.test(call.toolName || ""),
      ),
    ),
  ))
}

function buildHistoryEntries(items: RenderItem[]): HistoryEntry[] {
  return items.map((item, itemIndex) => ({ key: renderItemKey(item, itemIndex), item, itemIndex }))
}

function estimateHistoryEntrySize(
  entry: HistoryEntry | undefined,
  processOpen: boolean,
  toolOpen: boolean,
): number {
  if (!entry) return 120
  if (entry.item.kind === "process") return processOpen ? 96 + entry.item.parts.length * (toolOpen ? 160 : 40) : 36
  return entry.item.m.role === "user" ? 112 : 220
}

function withSetMembership(current: Set<string>, key: string, present: boolean): Set<string> {
  if (current.has(key) === present) return current
  const next = new Set(current)
  if (present) next.add(key)
  else next.delete(key)
  return next
}

function collectChangedKeys(previous: Set<string>, current: Set<string>, changed: Set<string>) {
  for (const key of previous) {
    if (!current.has(key)) changed.add(key)
  }
  for (const key of current) {
    if (!previous.has(key)) changed.add(key)
  }
}

function assignRef<T>(ref: Ref<T>, value: T | null): void {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}

const MESSAGE_ACTION_BUTTON =
  "items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
const MESSAGE_ACTION_SIZE = { width: 28, height: 28 }

function MessageActions({
  messageId,
  text,
  isUser,
  sending,
  forking,
  onEdit,
  onRegenerate,
  onFork,
  onDelete,
}: {
  messageId: string
  text: string
  isUser: boolean
  sending: boolean
  forking: boolean
  onEdit: () => void
  onRegenerate: () => void
  onFork: () => void
  onDelete: () => void
}) {
  useUiLocale()
  const copy = () => void navigator.clipboard?.writeText(text)

  return (
    <div
      data-message-actions={messageId}
      className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:opacity-0"
    >
      <button
        type="button"
        onClick={copy}
        className={`${MESSAGE_ACTION_BUTTON} hidden md:inline-flex`}
        style={MESSAGE_ACTION_SIZE}
        aria-label={uiText("copy_63d90d97")}
        title={uiText("copy_63d90d97")}
      >
        <Copy className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onFork}
        disabled={forking}
        className={`${MESSAGE_ACTION_BUTTON} hidden md:inline-flex`}
        style={MESSAGE_ACTION_SIZE}
        aria-label={uiText("fork_from_here_28321cb9")}
        title={uiText("fork_into_a_new_session_from_here_53c2881c")}
      >
        <GitFork className="size-3.5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${MESSAGE_ACTION_BUTTON} inline-flex`}
            style={MESSAGE_ACTION_SIZE}
            aria-label={uiText("more_message_actions_cecaef80")}
            title={uiText("more_message_actions_cecaef80")}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align={isUser ? "end" : "start"}
          className="rounded-xl"
          style={{ minWidth: "10rem" }}
        >
          <DropdownMenuItem className="md:hidden" onClick={copy}>
            <Copy />
            {uiText("copy_63d90d97")}</DropdownMenuItem>
          <DropdownMenuItem className="md:hidden" disabled={forking} onClick={onFork}>
            <GitFork />
            {uiText("fork_from_here_28321cb9")}</DropdownMenuItem>
          <DropdownMenuSeparator className="md:hidden" />
          {isUser ? (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              {uiText("edit_and_resend_f857c444")}</DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={sending} onClick={onRegenerate}>
              <RotateCcw />
              {uiText("regenerate_3221a042")}</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            {uiText("delete_2f9daa82")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function MessageList({
  scrollRef,
  contentRef,
  onScroll,
  messages,
  mergedSubAgents,
  sending,
  latestRunFinished,
  streaming,
  streamingActive,
  streamingReasoning,
  liveSegments,
  streamStatus,
  pendingUserText,
  contentShiftX = 0,
  readOnly = false,
  forking,
  onSelectSubAgent,
  onPreviewImage,
  onRegenerate,
  onFork,
  onDelete,
  onEditMessage,
}: {
  scrollRef: Ref<HTMLDivElement>
  contentRef: Ref<HTMLDivElement>
  onScroll: () => void
  messages: Message[]
  mergedSubAgents: Record<string, ChildProgress>
  sending: boolean
  /** The latest persisted run completed normally (`stop_reason = finished`). */
  latestRunFinished: boolean
  streaming: string | null
  streamingActive: boolean
  streamingReasoning: string | null
  liveSegments: LiveSegment[]
  streamStatus: string | null
  pendingUserText: string | null
  /** Horizontal transcript offset used while a floating panel occupies the end side. */
  contentShiftX?: number
  /** Suppress transcript actions for message-only child previews. */
  readOnly?: boolean
  forking: boolean
  onSelectSubAgent: (id: string) => void
  onPreviewImage: (src: string) => void
  onRegenerate: () => void
  onFork: (id: string) => void
  onDelete: (id: string) => void
  onEditMessage: (id: string, text: string) => void
}) {
  useUiLocale()
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null)

  const renderItems = useMemo(() => buildRenderItems(messages), [messages])
  const liveItems = useMemo(
    () => buildLiveItems(liveSegments, streaming, streamingReasoning, sending || streamingActive, streamStatus),
    [liveSegments, sending, streamStatus, streaming, streamingActive, streamingReasoning],
  )
  const actionableAssistantIndexes = useMemo(
    () => buildActionableAssistantIndexes(renderItems, !sending),
    [renderItems, sending],
  )
  const historyEntries = useMemo(() => buildHistoryEntries(renderItems), [renderItems])
  const [openProcessKeys, setOpenProcessKeys] = useState<Set<string>>(() => new Set())
  const [openToolKeys, setOpenToolKeys] = useState<Set<string>>(() => new Set())
  const historyEntriesRef = useRef(historyEntries)
  const openProcessKeysRef = useRef(openProcessKeys)
  const openToolKeysRef = useRef(openToolKeys)
  historyEntriesRef.current = historyEntries
  openProcessKeysRef.current = openProcessKeys
  openToolKeysRef.current = openToolKeys

  const scrollElementRef = useRef<HTMLDivElement | null>(null)
  const setScrollElement = useCallback((node: HTMLDivElement | null) => {
    scrollElementRef.current = node
    assignRef(scrollRef, node)
  }, [scrollRef])
  const getScrollElement = useCallback(() => scrollElementRef.current, [])
  const getItemKey = useCallback(
    (index: number) => historyEntriesRef.current[index]?.key ?? index,
    [],
  )
  const estimateSize = useCallback((index: number) => {
    const entry = historyEntriesRef.current[index]
    return estimateHistoryEntrySize(
      entry,
      Boolean(entry && openProcessKeysRef.current.has(entry.key)),
      entry?.item.kind === "process" && entry.item.parts.some((part) =>
        part.kind === "tools" && openToolKeysRef.current.has(`tools-${part.items[0]?.id}`),
      ),
    )
  }, [])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: historyEntries.length,
    getScrollElement,
    getItemKey,
    estimateSize,
    gap: HISTORY_ROW_GAP,
    overscan: 6,
    initialRect: INITIAL_VIRTUAL_RECT,
    observeElementRect: observeHistoryRect,
    measureElement: measureHistoryElement,
  })

  const previousExpansionStateRef = useRef({
    openProcessKeys,
    openToolKeys,
  })
  useLayoutEffect(() => {
    const previous = previousExpansionStateRef.current
    previousExpansionStateRef.current = { openProcessKeys, openToolKeys }
    const changedKeys = new Set<string>()
    collectChangedKeys(previous.openProcessKeys, openProcessKeys, changedKeys)
    collectChangedKeys(previous.openToolKeys, openToolKeys, changedKeys)
    if (changedKeys.size === 0) return

    const rows = scrollElementRef.current?.querySelectorAll<HTMLDivElement>(
      "[data-history-entry-key]",
    )
    for (const row of rows ?? []) {
      const ownsChange = row.dataset.historyEntryKey && changedKeys.has(row.dataset.historyEntryKey)
        || [...row.querySelectorAll<HTMLElement>("[data-expansion-key]")]
          .some((element) => changedKeys.has(element.dataset.expansionKey ?? ""))
      if (!ownsChange) continue
      const index = virtualizer.indexFromElement(row)
      virtualizer.resizeItem(index, row.offsetHeight || estimateSize(index))
    }
  }, [estimateSize, openProcessKeys, openToolKeys, virtualizer])

  const setProcessOpen = useCallback((key: string, open: boolean) => {
    setOpenProcessKeys((current) => withSetMembership(current, key, open))
  }, [])
  const setToolOpen = useCallback((key: string, open: boolean) => {
    setOpenToolKeys((current) => withSetMembership(current, key, open))
  }, [])

  // Anchor the sub-agent block after the tool-group that spawned them, so it
  // scrolls up with the conversation instead of staying pinned at the bottom.
  const spawnItemIdx = useMemo(() => {
    if (Object.keys(mergedSubAgents).length === 0) return -1
    return findSpawnItemIndex(renderItems)
  }, [renderItems, mergedSubAgents])
  const liveSpawnItemIdx = useMemo(() => Object.keys(mergedSubAgents).length
    ? findSpawnItemIndex(liveItems) : -1, [liveItems, mergedSubAgents])

  const renderItem = (
    it: RenderItem,
    idx: number,
    options?: { live?: boolean },
  ) => {
    if (it.kind === "process") {
      const active = options?.live ? it.active : idx === renderItems.length - 1 && sending && !pendingUserText && !latestRunFinished && liveItems.length === 0
      const reasoning = it.parts.findLast((part) => part.kind === "reasoning")
      const latestTool = it.parts.findLast((part) => part.kind === "tools" && part.runningCallIds?.size)
        ?? it.parts.findLast((part) => part.kind === "tools")
      const toolPart = latestTool?.kind === "tools" ? latestTool : undefined
      const latestCallIds = toolPart?.items.flatMap((message) => "type" in message && message.type === "tool_call" ? message.toolCalls.map((call) => call.toolCallId) : [])
      const latestCallId = latestCallIds?.findLast((id) => toolPart?.runningCallIds?.has(id)) ?? latestCallIds?.at(-1)
      const preview = toolPart && latestCallId ? {
        key: latestCallId,
        running: Boolean(toolPart.runningCallIds?.size),
        content: <ToolCalls items={toolPart.items} presentation="preview" active={Boolean(active && toolPart.runningCallIds?.size)} runningCallIds={toolPart.runningCallIds ?? new Set<string>()} />,
        snapshot: (key: string) => {
          const items = it.parts.flatMap((part) => part.kind === "tools" ? part.items.flatMap<Message>((message) => {
            if ("type" in message && message.type === "tool_call") {
              const calls = message.toolCalls.filter((call) => call.toolCallId === key)
              return calls.length ? [{ ...message, toolCalls: calls }] : []
            }
            return "toolCallId" in message && message.toolCallId === key ? [message] : []
          }) : [])
          const runningCallIds = new Set(it.parts.flatMap((part) => part.kind === "tools" ? [...part.runningCallIds ?? []] : []))
          return <ToolCalls items={items} presentation="preview" active={Boolean(active && runningCallIds.has(key))} runningCallIds={runningCallIds} />
        },
      } : undefined
      const startedAt = itemTimestamp(it)
      const finishedAt = itemTimestamp(it, "last")
      const elapsed = !options?.live && !active && toolCallCount([it]) && startedAt != null && finishedAt != null
        ? formatElapsedDuration(finishedAt - startedAt) : null
      const process = (
        <div data-expansion-key={it.key}>
          <ProcessActivity
            reasoning={reasoning?.kind === "reasoning" ? reasoning.text : undefined}
            toolCallCount={toolCallCount([it])}
            label={elapsed ? uiText("processed_db5f0926", { v0: elapsed }) : undefined}
            active={active}
            thinking={it.thinking}
            status={preview?.running ? undefined : it.status}
            hasDetails={it.parts.length > 0}
            preview={preview}
            open={openProcessKeys.has(it.key)}
            onOpenChange={(open) => setProcessOpen(it.key, open)}
          >
            <div className="-mx-3.5 flex flex-col gap-2">
              {it.parts.map((part, partIndex) => {
                if (part.kind === "reasoning") return (
                  <div key={`reasoning-${partIndex}`} className="px-3.5">
                    <Reasoning text={part.text} />
                  </div>
                )
                const toolKey = `tools-${part.items[0]?.id}`
                return (
                  <div key={toolKey} data-expansion-key={toolKey}>
                    <ToolCalls
                      items={part.items}
                      presentation="process"
                      singleExpanded={toolCallCount([it]) === 1}
                      active={part.runningCallIds !== undefined ? part.runningCallIds.size > 0 : Boolean(active && partIndex === it.parts.length - 1)}
                      runningCallIds={part.runningCallIds}
                      open={openToolKeys.has(toolKey)}
                      onOpenChange={(open) => setToolOpen(toolKey, open)}
                      onPreviewImage={onPreviewImage}
                    />
                  </div>
                )
              })}
            </div>
          </ProcessActivity>
        </div>
      )
      if (!options?.live && idx === spawnItemIdx) {
        return (
          <Fragment key={`spawn-${idx}`}>
            {process}
            <SubAgents agents={mergedSubAgents} onOpen={onSelectSubAgent} />
          </Fragment>
        )
      }
      return process
    }
    const m = it.m
    const text = messageText(m)
    const imgs = (
      m as { images?: Array<{ url?: string; base64?: string; type?: string }> }
    ).images
    const isUser = m.role === "user"
    const showMessageActions = !readOnly && !options?.live && (isUser || actionableAssistantIndexes.has(idx))
    // Truly empty (no text, no images, no reasoning) → skip the blank bubble.
    if (!text.trim() && !imgs?.length) return null

    if (isUser && editingMsg?.id === m.id) {
      return (
        <div key={m.id} className="flex flex-col items-end">
          <div className="w-full max-w-[85%]">
            <Textarea
              value={editingMsg.text}
              onChange={(e) => setEditingMsg({ id: m.id, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingMsg(null)
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  onEditMessage(m.id, editingMsg.text)
                  setEditingMsg(null)
                }
              }}
              autoFocus
              className="min-h-16 bg-card"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditingMsg(null)}>
                {uiText("cancel_2cd0f3be")}</Button>
              <Button
                size="sm"
                onClick={() => {
                  onEditMessage(m.id, editingMsg.text)
                  setEditingMsg(null)
                }}
              >
                {uiText("save_and_resend_b45cc57a")}</Button>
            </div>
          </div>
        </div>
      )
    }
    const actions = showMessageActions ? (
      <MessageActions
        messageId={m.id}
        text={text}
        isUser={isUser}
        sending={sending}
        forking={forking}
        onEdit={() => setEditingMsg({ id: m.id, text })}
        onRegenerate={onRegenerate}
        onFork={() => onFork(m.id)}
        onDelete={() => onDelete(m.id)}
      />
    ) : null

    return (
      <div
        key={m.id}
        data-message-row={m.id}
        className={cn(
          "group flex w-full items-end gap-1.5",
          isUser ? "justify-end" : "justify-start",
        )}
      >
        {isUser ? actions : null}
        <div
          data-message-role={isUser ? "user" : "assistant"}
          className={cn(
            MESSAGE_SURFACE_LAYOUT,
            isUser
              ? "user-message-surface whitespace-pre-wrap text-base leading-7"
              : ASSISTANT_MESSAGE_SURFACE,
          )}
        >
          {imgs?.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {imgs.map((im, i) => {
                const src = im.url || `data:${im.type || "image/png"};base64,${im.base64}`
                return (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="max-h-48 cursor-zoom-in rounded-xl transition-opacity hover:opacity-90"
                    onClick={() => onPreviewImage(src)}
                  />
                )
              })}
            </div>
          ) : null}
          {isUser ? (
            <>{m.role === "user" && "inReplyTo" in m && m.inReplyTo ? <div className="mb-1 text-xs" data-testid="message-request-reference">{uiText("ticket_referenced_request__7209ca36")}{m.inReplyTo}</div> : null}{text}</>
          ) : text.trim() ? (
            <AssistantMarkdown isStreaming={Boolean(it.streaming)} onPreviewImage={onPreviewImage}>{text}</AssistantMarkdown>
          ) : null}
        </div>
        {isUser ? null : actions}
      </div>
    )
  }

  const renderHistoryEntry = (entry: HistoryEntry) => renderItem(entry.item, entry.itemIndex)

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={setScrollElement} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3">
      <div
        ref={contentRef}
        data-message-list-content
        className="relative mx-auto flex w-full max-w-6xl flex-col gap-2 py-4"
        style={{
          left: contentShiftX,
          transition: "left 200ms ease-out",
        }}
      >
        {messages.length === 0 && !streaming && !pendingUserText && liveSegments.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <BrandMark className="size-10 text-primary" />
            <p className="text-sm text-muted-foreground">{uiText("start_a_new_conversation_bab6ab18")}</p>
          </div>
        )}

        {historyEntries.length > 0 ? (
          <div
            data-virtual-history
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((virtualItem) => {
              const entry = historyEntries[virtualItem.index]
              if (!entry) return null
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-history-entry-key={entry.key}
                  data-index={virtualItem.index}
                  className={cn(
                    "absolute left-0 top-0 w-full",
                    virtualItem.index > 0 &&
                      entry.item.kind === "msg" &&
                      entry.item.m.role === "user" &&
                      "pt-2",
                  )}
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {renderHistoryEntry(entry)}
                </div>
              )
            })}
          </div>
        ) : null}

        {pendingUserText ? (
          <div className="mt-2 flex justify-end">
            <div data-pending-user-message data-message-role="user" className="user-message-surface max-w-[85%] overflow-hidden whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-base leading-7 [overflow-wrap:anywhere]">
              {pendingUserText}
            </div>
          </div>
        ) : null}

        {spawnItemIdx === -1 && liveSpawnItemIdx === -1 ? (
          <SubAgents agents={mergedSubAgents} onOpen={onSelectSubAgent} />
        ) : null}

        {/* The live projection uses the same message-only activity boundaries. */}
        {liveItems.map((item, index) => (
          <Fragment key={renderItemKey(item, index)}>
            {renderItem(item, index, { live: true })}
            {index === liveSpawnItemIdx && spawnItemIdx === -1 ? (
              <SubAgents agents={mergedSubAgents} onOpen={onSelectSubAgent} />
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
