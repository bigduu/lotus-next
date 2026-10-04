import { uiText, useUiLocale } from "@shared/i18n/ui"
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
import { useActorSnapshot } from "@/hooks/useActorSnapshot"
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
  useUiLocale()
  const transcript = useSubagentTranscript(sessionId)
  const selectedChild = chats.find((chat) => chat.id === sessionId && chat.kind === "child")
  // An index entry without its authoritative Root relationship cannot grant an
  // Actor channel. The legacy projected message transcript remains independent.
  const rootId = selectedChild?.rootSessionId ?? null
  const preview = useActorSnapshot(rootId, !!rootId && !!sessionId, sessionId)
  const { scrollRef, contentRef, atBottom, handleScroll, scrollToBottom } =
    useStickyScroll(sessionId)

  const body = !sessionId ? (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {uiText("select_a_subagent_to_load_its_message_history_d73b4879")}</div>
  ) : transcript.loading && transcript.messages.length === 0 ? (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
      aria-label={uiText("loading_subagent_messages_c313f76d")}
    >
      <LoaderCircle className="size-4 animate-spin" />
      {uiText("loading_messages_bade7d59")}</div>
  ) : transcript.error && transcript.messages.length === 0 ? (
    <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-destructive">
      <p>{transcript.error}</p>
      <Button size="sm" variant="outline" onClick={transcript.retry}>
        <RefreshCw />
        {uiText("retry_b8784c8d")}</Button>
    </div>
  ) : transcript.messages.length === 0 ? (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {uiText("this_subagent_has_no_messages_to_display_yet_540b699c")}</div>
  ) : (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {transcript.error ? (
        <div role="alert" className="mx-4 mt-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
          <span>{transcript.error}</span>
          <Button size="sm" variant="ghost" onClick={transcript.retry}>
            {uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}
      {transcript.truncated ? (
        <div role="status" className="mx-4 mt-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          {uiText("earlier_subagent_messages_are_omitted_only_recent_messa_103a24b5")}</div>
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
          aria-label={uiText("scroll_to_bottom_2b05ff67")}
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
            <SelectValue placeholder={uiText("select_subagent_aceda583")} />
          </SelectTrigger>
          <SelectContent>
            {chats
              .filter((chat) => !chat.parentSessionId || chat.id === sessionId)
              .map((chat) => (
                <SelectItem key={chat.id} value={chat.id}>
                  {chat.title || uiText("new_session_c57c30bc")}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      {preview.gapReason ? <p role="status" data-actor-gap={preview.gapReason} className="border-b px-3 py-2 text-xs text-muted-foreground">
        {uiText("there_is_a_gap_in_subagent_events_state_was_reloaded_bu_463a89f1")}</p> : null}
      {body}
    </div>
  )
}
