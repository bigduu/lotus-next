import { Fragment, useMemo, useState, type RefObject } from "react"
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

export function MessageList({
  scrollRef,
  contentRef,
  onScroll,
  messages,
  mergedSubAgents,
  sending,
  streaming,
  streamingReasoning,
  liveSegments,
  streamStatus,
  pendingUserText,
  forking,
  onSelectSubAgent,
  onPreviewImage,
  onRegenerate,
  onFork,
  onDelete,
  onEditMessage,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  messages: Message[]
  mergedSubAgents: Record<string, ChildProgress>
  sending: boolean
  streaming: string | null
  streamingReasoning: string | null
  liveSegments: LiveSegment[]
  streamStatus: string | null
  pendingUserText: string | null
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

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div ref={contentRef} className="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
        {messages.length === 0 && !streaming && !pendingUserText && liveSegments.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="size-10 rounded-xl bg-primary" />
            <p className="text-sm text-muted-foreground">开始一段新对话</p>
          </div>
        )}

        {renderItems.map((it, idx) => {
          if (it.kind === "tools") {
            const isLast = idx === renderItems.length - 1
            const tools = (
              <ToolCalls
                key={it.items[0]?.id ?? `tools-${idx}`}
                items={it.items}
                active={isLast && (sending || streaming !== null)}
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
          const reasoning = isUser ? "" : messageReasoning(m)
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
                className={cn(
                  "max-w-[85%] overflow-hidden rounded-2xl px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]",
                  isUser
                    ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
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
                {isUser ? text : text.trim() ? <AssistantMarkdown>{text}</AssistantMarkdown> : null}
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
              <div className="max-w-[85%] overflow-hidden rounded-2xl bg-muted px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
                {seg.reasoning ? <Reasoning text={seg.reasoning} /> : null}
                {seg.text.trim() ? <AssistantMarkdown>{seg.text}</AssistantMarkdown> : null}
              </div>
            </div>
          ),
        )}

        {streaming !== null && (
          <div className="flex justify-start">
            <div
              className="max-w-[85%] overflow-hidden rounded-2xl bg-muted px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]"
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
                <AssistantMarkdown>{streaming}</AssistantMarkdown>
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
