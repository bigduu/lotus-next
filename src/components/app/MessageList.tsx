import { Fragment, useMemo, useState, type Ref } from "react"
import { Copy, Pencil, RotateCcw, GitFork, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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

const MESSAGE_SURFACE_LAYOUT =
  "max-w-[85%] overflow-hidden rounded-2xl px-3.5 py-2 [overflow-wrap:anywhere]"
const ASSISTANT_MESSAGE_SURFACE =
  "bg-transparent text-[15px] font-medium leading-7 text-foreground"

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
  const completedProcessLayout = useMemo(
    () => buildCompletedProcessLayout(renderItems, latestRunFinished),
    [latestRunFinished, renderItems],
  )
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
      const tools = (
        <ToolCalls
          key={it.items[0]?.id ?? `tools-${idx}`}
          items={it.items}
          // A retained final stream is display content, not evidence that
          // the persisted tool round is still running. ChatPane passes a
          // session-scoped running value here.
          active={isLast && sending}
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
    return (
      <div
        key={m.id}
        className={cn("group flex flex-col", isUser ? "items-end" : "items-start")}
      >
        <div
          data-message-role={isUser ? "user" : "assistant"}
          className={cn(
            MESSAGE_SURFACE_LAYOUT,
            isUser
              ? "whitespace-pre-wrap bg-primary text-sm leading-relaxed text-primary-foreground"
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
        <div className="mt-1 flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button
            onClick={() => void navigator.clipboard?.writeText(text)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="复制"
          >
            <Copy className="size-3.5" />
          </button>
          {isUser ? (
            <button
              onClick={() => setEditingMsg({ id: m.id, text })}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="编辑"
              title="编辑并重发"
            >
              <Pencil className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={onRegenerate}
              disabled={sending}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="重新生成"
              title="重新生成"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
          <button
            onClick={() => onFork(m.id)}
            disabled={forking}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="从这里分叉"
            title="从这里分叉成新会话"
          >
            <GitFork className="size-3.5" />
          </button>
          <button
            onClick={() => onDelete(m.id)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
            aria-label="删除"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div
        ref={contentRef}
        data-message-list-content
        className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4"
        style={{
          transform: `translateX(${contentShiftX}px)`,
          transition: "transform 200ms ease-out",
        }}
      >
        {messages.length === 0 && !streaming && !pendingUserText && liveSegments.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="size-10 rounded-xl bg-primary" />
            <p className="text-sm text-muted-foreground">开始一段新对话</p>
          </div>
        )}

        {renderItems.map((it, idx) => {
          const completedProcess = completedProcessLayout.byStart.get(idx)
          if (completedProcess) {
            return (
              <details
                key={completedProcess.key}
                data-completed-process
                className="w-full"
              >
                <summary
                  className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground"
                  title={`${completedProcess.toolCallCount} 次工具调用`}
                >
                  {completedProcess.label}
                </summary>
                <div className="mt-3 flex flex-col gap-4 border-l-2 border-border pl-2.5">
                  {renderItems
                    .slice(completedProcess.startIndex, completedProcess.endIndex + 1)
                    .map((processItem, processOffset) =>
                      renderItem(processItem, completedProcess.startIndex + processOffset),
                    )}
                  {completedProcess.finalReasoning ? (
                    <div className="flex justify-start">
                      <div
                        data-completed-final-reasoning
                        className={cn(MESSAGE_SURFACE_LAYOUT, ASSISTANT_MESSAGE_SURFACE)}
                      >
                        <Reasoning text={completedProcess.finalReasoning} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
            )
          }
          if (completedProcessLayout.foldedIndexes.has(idx)) return null
          return renderItem(it, idx, {
            suppressReasoning: completedProcessLayout.finalReasoningIndexes.has(idx),
          })
        })}

        {pendingUserText ? (
          <div className="flex justify-end">
            <div className="max-w-[85%] overflow-hidden whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground [overflow-wrap:anywhere]">
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
