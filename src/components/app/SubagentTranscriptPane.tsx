import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react"

import { MessageList } from "@/components/app/MessageList"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useStickyScroll } from "@/hooks/useStickyScroll"
import { useSubagentTranscript } from "@/hooks/useSubagentTranscript"
import type { ChatItem } from "@shared/types/chat"

const noop = () => {}

export function SubagentTranscriptPane({
  sessionId,
  chats,
  onPickSession,
}: {
  sessionId: string | null
  chats: ChatItem[]
  onPickSession: (sessionId: string | null) => void
}) {
  const transcript = useSubagentTranscript(sessionId)
  const { scrollRef, contentRef, atBottom, handleScroll, scrollToBottom } =
    useStickyScroll(sessionId)

  const body = !sessionId ? (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      选择一个子代理后加载其消息历史。
    </div>
  ) : transcript.loading && transcript.messages.length === 0 ? (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
      aria-label="正在加载子代理消息"
    >
      <LoaderCircle className="size-4 animate-spin" />
      正在加载消息…
    </div>
  ) : transcript.error && transcript.messages.length === 0 ? (
    <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-destructive">
      <p>{transcript.error}</p>
      <Button size="sm" variant="outline" onClick={transcript.retry}>
        <RefreshCw />
        重试
      </Button>
    </div>
  ) : transcript.messages.length === 0 ? (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      这个子代理还没有可显示的消息。
    </div>
  ) : (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {transcript.error ? (
        <div role="alert" className="mx-4 mt-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
          <span>{transcript.error}</span>
          <Button size="sm" variant="ghost" onClick={transcript.retry}>
            重试
          </Button>
        </div>
      ) : null}
      {transcript.truncated ? (
        <div role="status" className="mx-4 mt-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          较早的子代理消息已省略；这里只显示最近的消息。
        </div>
      ) : null}
      <MessageList
        scrollRef={scrollRef}
        contentRef={contentRef}
        onScroll={handleScroll}
        messages={transcript.messages}
        mergedSubAgents={{}}
        sending={transcript.streaming}
        latestRunFinished={!transcript.streaming}
        streaming={null}
        streamingActive={false}
        streamingReasoning={null}
        liveSegments={[]}
        streamStatus={null}
        pendingUserText={null}
        readOnly
        forking={false}
        onSelectSubAgent={noop}
        onPreviewImage={noop}
        onRegenerate={noop}
        onFork={noop}
        onDelete={noop}
        onEditMessage={noop}
      />
      {!atBottom ? (
        <Button
          size="icon"
          variant="outline"
          aria-label="滚动到底部"
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full shadow-lg"
          onClick={scrollToBottom}
        >
          <ChevronDown />
        </Button>
      ) : null}
    </div>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-subagent-transcript-pane>
      <div className="flex shrink-0 items-center border-b px-3 py-2">
        <Select
          value={sessionId ?? undefined}
          onValueChange={(value) => onPickSession(value || null)}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue placeholder="选择子代理…" />
          </SelectTrigger>
          <SelectContent>
            {chats
              .filter((chat) => !chat.parentSessionId || chat.id === sessionId)
              .map((chat) => (
                <SelectItem key={chat.id} value={chat.id}>
                  {chat.title || "新会话"}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      {body}
    </div>
  )
}
