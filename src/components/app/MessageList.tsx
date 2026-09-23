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
import { StreamingReasoning } from "@/components/chat/StreamingReasoning"
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
    if (c.output || c.status !== "running") {
      out.push({
        id: `live-res-${c.toolCallId}`,
        role: "tool",
        type: "tool_result",
        toolCallId: c.toolCallId,
        isError: c.status === "error",
        result: { result: c.status === "error" ? c.error || c.output : c.output },
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

type RenderItem = { kind: "msg"; m: Message } | { kind: "tools"; items: Message[] }

type CompletedProcessGroup = {
  startIndex: number
  endIndex: number
  key: string
  label: string
  toolCallCount: number
  finalReasoning: string
}

type CompletedProcessLayout = {
  byStart: Map<number, CompletedProcessGroup>
  foldedIndexes: Set<number>
  finalReasoningIndexes: Set<number>
}

type HistoryEntry =
  | {
      kind: "item"
      key: string
      item: RenderItem
      itemIndex: number
      suppressReasoning: boolean
    }
  | {
      kind: "completed-process"
      key: string
      group: CompletedProcessGroup
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

// Collapse consecutive tool messages into one group so a round's tool calls
// show as a single compact chip instead of many full-width lines.
function buildRenderItems(messages: Message[]): RenderItem[] {
  const out: RenderItem[] = []
  for (const m of messages) {
    if (m.role === "system") continue
    if (isToolMessage(m)) {
      const last = out[out.length - 1]
      if (last && last.kind === "tools") last.items.push(m)
      else out.push({ kind: "tools", items: [m] })
    } else {
      out.push({ kind: "msg", m })
    }
  }
  return out
}

function itemTimestamp(item: RenderItem, edge: "first" | "last" = "first"): number | null {
  const messages = item.kind === "msg" ? [item.m] : item.items
  const ordered = edge === "first" ? messages : [...messages].reverse()
  for (const message of ordered) {
    const timestamp = Date.parse(String(message.createdAt || ""))
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
  if (hours > 0) return `${hours}小时${minutes > 0 ? `${minutes}分` : ""}`
  if (minutes > 0) return `${minutes}分${seconds > 0 ? `${seconds}秒` : ""}`
  return `${seconds}秒`
}

function isFinalAssistantResponse(item: RenderItem): boolean {
  if (item.kind !== "msg" || item.m.role !== "assistant") return false
  const images = (item.m as { images?: unknown[] }).images
  return Boolean(messageText(item.m).trim() || messageReasoning(item.m).trim() || images?.length)
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
    if (item.kind !== "tools") continue
    for (const message of item.items) {
      for (const call of (message as { toolCalls?: { toolCallId?: string }[] }).toolCalls ?? []) {
        if (call.toolCallId) ids.add(call.toolCallId)
      }
    }
  }
  return ids.size
}

/**
 * Fold the process portion of completed turns while leaving the final answer
 * visible. Earlier turns are known to be terminal once a later user message
 * exists; the latest turn waits for Bamboo's persisted `completed` run state,
 * which is Lotus's equivalent of a provider `stop_reason = finished`.
 */
function buildCompletedProcessLayout(
  items: RenderItem[],
  latestRunFinished: boolean,
): CompletedProcessLayout {
  const byStart = new Map<number, CompletedProcessGroup>()
  const foldedIndexes = new Set<number>()
  const finalReasoningIndexes = new Set<number>()
  const userIndexes = items.flatMap((item, index) =>
    item.kind === "msg" && item.m.role === "user" ? [index] : [],
  )

  userIndexes.forEach((userIndex, turnIndex) => {
    const isLatestTurn = turnIndex === userIndexes.length - 1
    if (isLatestTurn && !latestRunFinished) return
    const turnEnd = (userIndexes[turnIndex + 1] ?? items.length) - 1
    const processStart = userIndex + 1
    let lastToolIndex = -1
    for (let index = processStart; index <= turnEnd; index += 1) {
      if (items[index]?.kind === "tools") lastToolIndex = index
    }
    if (lastToolIndex < processStart) return

    let finalResponseIndex = -1
    for (let index = turnEnd; index > lastToolIndex; index -= 1) {
      if (isFinalAssistantResponse(items[index])) {
        finalResponseIndex = index
        break
      }
    }
    // For older turns, a final response is the only durable evidence available
    // that the tool process finished normally. The latest turn has the explicit
    // completed status and may legitimately end without a text response.
    if (!isLatestTurn && finalResponseIndex < 0) return

    const processEnd = finalResponseIndex >= 0 ? finalResponseIndex - 1 : turnEnd
    if (processEnd < processStart) return
    const processItems = items.slice(processStart, processEnd + 1)
    const calls = toolCallCount(processItems)
    if (calls === 0) return

    const startedAt = itemTimestamp(items[userIndex])
    const finishedAt = itemTimestamp(
      items[finalResponseIndex >= 0 ? finalResponseIndex : processEnd],
      "last",
    )
    const elapsed = startedAt != null && finishedAt != null
      ? formatElapsedDuration(finishedAt - startedAt)
      : null
    const userMessage = items[userIndex]
    const key = userMessage.kind === "msg" ? userMessage.m.id : String(userIndex)
    const finalResponse = finalResponseIndex >= 0 ? items[finalResponseIndex] : null
    const finalReasoning = finalResponse?.kind === "msg"
      ? messageReasoning(finalResponse.m)
      : ""
    byStart.set(processStart, {
      startIndex: processStart,
      endIndex: processEnd,
      key: `completed-process-${key}`,
      label: elapsed ? `处理了 ${elapsed}` : "已完成的处理过程",
      toolCallCount: calls,
      finalReasoning,
    })
    for (let index = processStart; index <= processEnd; index += 1) {
      foldedIndexes.add(index)
    }
    if (finalReasoning) finalReasoningIndexes.add(finalResponseIndex)
  })

  return { byStart, foldedIndexes, finalReasoningIndexes }
}

function renderItemKey(item: RenderItem, index: number): string {
  if (item.kind === "msg") return `message-${item.m.id}`
  return `tools-${item.items[0]?.id ?? index}`
}

function hasRenderableMessageContent(message: Message, suppressReasoning: boolean): boolean {
  const images = (message as { images?: unknown[] }).images
  return Boolean(
    messageText(message).trim() ||
    images?.length ||
    (!suppressReasoning && messageReasoning(message)),
  )
}

function buildHistoryEntries(
  items: RenderItem[],
  layout: CompletedProcessLayout,
): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  for (let index = 0; index < items.length; index += 1) {
    const completedProcess = layout.byStart.get(index)
    if (completedProcess) {
      entries.push({
        kind: "completed-process",
        key: completedProcess.key,
        group: completedProcess,
      })
      index = completedProcess.endIndex
      continue
    }
    if (layout.foldedIndexes.has(index)) continue
    const item = items[index]
    const suppressReasoning = layout.finalReasoningIndexes.has(index)
    if (item.kind === "msg" && !hasRenderableMessageContent(item.m, suppressReasoning)) continue
    entries.push({
      kind: "item",
      key: renderItemKey(item, index),
      item,
      itemIndex: index,
      suppressReasoning,
    })
  }
  return entries
}

function estimateHistoryEntrySize(
  entry: HistoryEntry | undefined,
  processOpen: boolean,
  toolOpen: boolean,
): number {
  if (!entry) return 120
  if (entry.kind === "completed-process") {
    const processLength = entry.group.endIndex - entry.group.startIndex + 1
    return processOpen ? Math.min(720, 96 + processLength * 120) : 28
  }
  if (entry.item.kind === "tools") return toolOpen ? 280 : 36
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
        aria-label="复制"
        title="复制"
      >
        <Copy className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onFork}
        disabled={forking}
        className={`${MESSAGE_ACTION_BUTTON} hidden md:inline-flex`}
        style={MESSAGE_ACTION_SIZE}
        aria-label="从这里分叉"
        title="从这里分叉成新会话"
      >
        <GitFork className="size-3.5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${MESSAGE_ACTION_BUTTON} inline-flex`}
            style={MESSAGE_ACTION_SIZE}
            aria-label="更多消息操作"
            title="更多消息操作"
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
            复制
          </DropdownMenuItem>
          <DropdownMenuItem className="md:hidden" disabled={forking} onClick={onFork}>
            <GitFork />
            从这里分叉
          </DropdownMenuItem>
          <DropdownMenuSeparator className="md:hidden" />
          {isUser ? (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              编辑并重发
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={sending} onClick={onRegenerate}>
              <RotateCcw />
              重新生成
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            删除
          </DropdownMenuItem>
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
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null)

  const renderItems = useMemo(() => buildRenderItems(messages), [messages])
  const actionableAssistantIndexes = useMemo(
    () => buildActionableAssistantIndexes(renderItems, !sending),
    [renderItems, sending],
  )
  const completedProcessLayout = useMemo(
    () => buildCompletedProcessLayout(renderItems, latestRunFinished),
    [latestRunFinished, renderItems],
  )
  const historyEntries = useMemo(
    () => buildHistoryEntries(renderItems, completedProcessLayout),
    [completedProcessLayout, renderItems],
  )
  const [openProcessKeys, setOpenProcessKeys] = useState<Set<string>>(() => new Set())
  const [openToolKeys, setOpenToolKeys] = useState<Set<string>>(() => new Set())
  const [showAllToolKeys, setShowAllToolKeys] = useState<Set<string>>(() => new Set())
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
      entry?.kind === "completed-process" && openProcessKeysRef.current.has(entry.key),
      entry?.kind === "item" && entry.item.kind === "tools" && openToolKeysRef.current.has(entry.key),
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
    showAllToolKeys,
  })
  useLayoutEffect(() => {
    const previous = previousExpansionStateRef.current
    previousExpansionStateRef.current = { openProcessKeys, openToolKeys, showAllToolKeys }
    const changedKeys = new Set<string>()
    collectChangedKeys(previous.openProcessKeys, openProcessKeys, changedKeys)
    collectChangedKeys(previous.openToolKeys, openToolKeys, changedKeys)
    collectChangedKeys(previous.showAllToolKeys, showAllToolKeys, changedKeys)
    if (changedKeys.size === 0) return

    const rows = scrollElementRef.current?.querySelectorAll<HTMLDivElement>(
      "[data-history-entry-key]",
    )
    for (const row of rows ?? []) {
      if (!row.dataset.historyEntryKey || !changedKeys.has(row.dataset.historyEntryKey)) continue
      const index = virtualizer.indexFromElement(row)
      virtualizer.resizeItem(index, row.offsetHeight || estimateSize(index))
    }
  }, [estimateSize, openProcessKeys, openToolKeys, showAllToolKeys, virtualizer])

  const setProcessOpen = useCallback((key: string, open: boolean) => {
    setOpenProcessKeys((current) => withSetMembership(current, key, open))
  }, [])
  const setToolOpen = useCallback((key: string, open: boolean) => {
    setOpenToolKeys((current) => withSetMembership(current, key, open))
  }, [])
  const setToolShowAll = useCallback((key: string, showAll: boolean) => {
    setShowAllToolKeys((current) => withSetMembership(current, key, showAll))
  }, [])

  // Anchor the sub-agent block after the tool-group that spawned them, so it
  // scrolls up with the conversation instead of staying pinned at the bottom.
  const spawnItemIdx = useMemo(() => {
    if (Object.keys(mergedSubAgents).length === 0) return -1
    for (let i = renderItems.length - 1; i >= 0; i -= 1) {
      const it = renderItems[i]
      if (
        it.kind === "tools" &&
        it.items.some((m) =>
          (m as { toolCalls?: { toolName?: string }[] }).toolCalls?.some((tc) =>
            /task|sub.?agent|spawn/i.test(tc.toolName || ""),
          ),
        )
      ) {
        return i
      }
    }
    return -1
  }, [renderItems, mergedSubAgents])

  const renderItem = (
    it: RenderItem,
    idx: number,
    options?: { suppressReasoning?: boolean },
  ) => {
    if (it.kind === "tools") {
      const isLast = idx === renderItems.length - 1
      const toolStateKey = renderItemKey(it, idx)
      const tools = (
        <ToolCalls
          key={it.items[0]?.id ?? `tools-${idx}`}
          items={it.items}
          // A retained final stream is display content, not evidence that
          // the persisted tool round is still running. ChatPane passes a
          // session-scoped running value here.
          active={isLast && sending}
          open={openToolKeys.has(toolStateKey)}
          onOpenChange={(open) => setToolOpen(toolStateKey, open)}
          showAll={showAllToolKeys.has(toolStateKey)}
          onShowAllChange={(showAll) => setToolShowAll(toolStateKey, showAll)}
        />
      )
      if (idx === spawnItemIdx) {
        return (
          <Fragment key={`spawn-${idx}`}>
            {tools}
            <SubAgents agents={mergedSubAgents} onOpen={onSelectSubAgent} />
          </Fragment>
        )
      }
      return tools
    }
    const m = it.m
    const text = messageText(m)
    const imgs = (
      m as { images?: Array<{ url?: string; base64?: string; type?: string }> }
    ).images
    const isUser = m.role === "user"
    const showMessageActions = !readOnly && (isUser || actionableAssistantIndexes.has(idx))
    const reasoning = isUser || options?.suppressReasoning ? "" : messageReasoning(m)
    // Truly empty (no text, no images, no reasoning) → skip the blank bubble.
    if (!text.trim() && !imgs?.length && !reasoning) return null

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
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onEditMessage(m.id, editingMsg.text)
                  setEditingMsg(null)
                }}
              >
                保存并重发
              </Button>
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
              ? "whitespace-pre-wrap bg-primary text-base leading-7 text-primary-foreground"
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
          {reasoning ? <Reasoning text={reasoning} /> : null}
          {isUser ? (
            text
          ) : text.trim() ? (
            <AssistantMarkdown isStreaming={false}>{text}</AssistantMarkdown>
          ) : null}
        </div>
        {isUser ? null : actions}
      </div>
    )
  }

  const renderHistoryEntry = (entry: HistoryEntry) => {
    if (entry.kind === "item") {
      return renderItem(entry.item, entry.itemIndex, {
        suppressReasoning: entry.suppressReasoning,
      })
    }

    const processOpen = openProcessKeys.has(entry.key)
    return (
      <details
        open={processOpen}
        data-completed-process
        className="w-full"
      >
        <summary
          onClick={(event) => {
            event.preventDefault()
            setProcessOpen(entry.key, !processOpen)
          }}
          className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground"
          title={`${entry.group.toolCallCount} 次工具调用`}
        >
          {entry.group.label}
        </summary>
        {processOpen ? (
          <div className="mt-2 flex flex-col gap-2 border-l-2 border-border pl-2.5">
            {renderItems
              .slice(entry.group.startIndex, entry.group.endIndex + 1)
              .map((processItem, processOffset) =>
                renderItem(processItem, entry.group.startIndex + processOffset),
              )}
            {entry.group.finalReasoning ? (
              <div className="flex justify-start">
                <div
                  data-completed-final-reasoning
                  className={cn(MESSAGE_SURFACE_LAYOUT, ASSISTANT_MESSAGE_SURFACE)}
                >
                  <Reasoning text={entry.group.finalReasoning} />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </details>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={setScrollElement} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div
        ref={contentRef}
        data-message-list-content
        className="relative mx-auto flex w-full max-w-6xl flex-col gap-2 px-3 py-4"
        style={{
          left: contentShiftX,
          transition: "left 200ms ease-out",
          WebkitFontSmoothing: "auto",
        }}
      >
        {messages.length === 0 && !streaming && !pendingUserText && liveSegments.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="size-10 rounded-xl bg-primary" />
            <p className="text-sm text-muted-foreground">开始一段新对话</p>
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
                      entry.kind === "item" &&
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
            <div className="max-w-[85%] overflow-hidden whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-base leading-7 text-primary-foreground [overflow-wrap:anywhere]">
              {pendingUserText}
            </div>
          </div>
        ) : null}

        {spawnItemIdx === -1 ? (
          <SubAgents agents={mergedSubAgents} onOpen={onSelectSubAgent} />
        ) : null}

        {/* Frozen live-run timeline: text rounds + tool groups streamed so far. */}
        {liveSegments.map((seg, i) =>
          seg.kind === "tools" ? (
            <ToolCalls
              key={`live-tools-${i}`}
              items={liveToolMessages(seg)}
              active={seg.calls.some((c) => c.status === "running")}
            />
          ) : (
            <div key={`live-text-${i}`} className="flex justify-start">
              <div
                data-message-role="assistant"
                className={cn(
                  MESSAGE_SURFACE_LAYOUT,
                  ASSISTANT_MESSAGE_SURFACE,
                )}
              >
                {seg.reasoning ? <Reasoning text={seg.reasoning} /> : null}
                {seg.text.trim() ? (
                  <AssistantMarkdown isStreaming={false}>{seg.text}</AssistantMarkdown>
                ) : null}
              </div>
            </div>
          ),
        )}

        {streaming !== null && (
          <div className="flex justify-start">
            <div
              data-message-role="assistant"
              className={cn(
                MESSAGE_SURFACE_LAYOUT,
                ASSISTANT_MESSAGE_SURFACE,
              )}
              style={{ transform: "translateZ(0)" }}
            >
              {streamingReasoning ? (
                // Live reasoning ("思考过程") so the user sees progress instead of
                // waiting on a blank bubble while the model thinks.
                <StreamingReasoning text={streamingReasoning} spaced={!!streaming} />
              ) : null}
              {streaming ? (
                // Live markdown while streaming (RAF-throttled to once/frame),
                // with provider built-in-tool blocks folded the same as the
                // final message — so no raw **/``` flash mid-stream.
                <AssistantMarkdown isStreaming={streamingActive}>{streaming}</AssistantMarkdown>
              ) : streamingReasoning ? null : streamStatus ? (
                // "what is the agent doing" one-liner (tool running / compacting)
                // instead of anonymous dots while no text streams.
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                  {streamStatus}
                </span>
              ) : (
                <span className="inline-flex gap-1">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
