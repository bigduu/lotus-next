import { createEffect, createMemo, createSignal, Match, onSettled, Show, Switch, untrack } from "solid-js"
import { ChevronDown, LoaderCircle, RefreshCw } from "@lucide/solid"

import { messageOccurrenceKey } from "@shared/types/chatMessages"

import { MessageBody } from "../../chat/MessageBody"
import { VirtualHistory, type HistoryReadingAnchor } from "../../history/VirtualHistory"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"

import { createSubagentTranscript } from "./createSubagentTranscript"

export interface SubagentTranscriptPaneProps {
  sessionId: string
  readingAnchor?: HistoryReadingAnchor
  onReadingAnchor?: (anchor: HistoryReadingAnchor | null) => void
  theme?: "light" | "dark"
  onOpenLink?: (url: string) => void
  onPreviewImage?: (url: string) => void
}

export function SubagentTranscriptPane(props: SubagentTranscriptPaneProps) {
  const text = createUiText()
  const transcript = createSubagentTranscript(() => props.sessionId)
  const anchor = untrack(() => props.readingAnchor)
  const [following, setFollowing] = createSignal(!anchor)
  const entries = createMemo(() => transcript.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ key: messageOccurrenceKey(message), message })))
  let viewport: HTMLDivElement | null = null
  let resize: ResizeObserver | undefined
  let scrollFrame: number | undefined

  const follow = () => {
    if (!viewport || scrollFrame !== undefined || !following()) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      if (viewport && following()) viewport.scrollTop = viewport.scrollHeight
    })
  }
  const restoreFollowing = () => { setFollowing(true); follow() }
  const trackViewport = (element: HTMLDivElement | null) => {
    resize?.disconnect()
    viewport = element
    if (element?.firstElementChild) {
      resize = new ResizeObserver(follow)
      resize.observe(element.firstElementChild)
    }
    follow()
  }

  createEffect(entries, follow)
  onSettled(() => () => {
    resize?.disconnect()
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
  })

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-subagent-transcript-pane="">
      <Switch>
        <Match when={transcript.loading && entries().length === 0}>
          <div class="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
            aria-label={text("loading_subagent_messages_c313f76d")}>
            <LoaderCircle class="size-4 animate-spin" />{text("loading_messages_bade7d59")}
          </div>
        </Match>
        <Match when={transcript.error && entries().length === 0}>
          <div role="alert" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-destructive">
            <p>{transcript.error}</p>
            <Button size="sm" variant="outline" onClick={transcript.retry}><RefreshCw />{text("retry_b8784c8d")}</Button>
          </div>
        </Match>
        <Match when={entries().length === 0}>
          <div class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {text("this_subagent_has_no_messages_to_display_yet_540b699c")}
          </div>
        </Match>
        <Match when={entries().length > 0}>
          <div class="relative flex min-h-0 flex-1 flex-col">
            <Show when={transcript.error}>
              <div role="alert" class="mx-4 mt-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
                <span>{transcript.error}</span>
                <Button size="sm" variant="ghost" onClick={transcript.retry}>{text("retry_b8784c8d")}</Button>
              </div>
            </Show>
            <Show when={transcript.truncated}>
              <div role="status" class="mx-4 mt-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
                {text("earlier_subagent_messages_are_omitted_only_recent_messa_103a24b5")}
              </div>
            </Show>
            <VirtualHistory
              entries={entries()}
              estimateSize={() => 96}
              initialReadingAnchor={transcript.loading ? null : anchor}
              onReadingAnchor={props.onReadingAnchor}
              onMissingReadingAnchor={restoreFollowing}
              onScrollElement={trackViewport}
              onScroll={() => {
                if (viewport) setFollowing(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 24)
              }}
              renderEntry={(entry) => (
                <MessageBody message={entry().message} theme={props.theme ?? "light"}
                  onOpenLink={(url) => props.onOpenLink?.(url)} onPreviewImage={(url) => props.onPreviewImage?.(url)} />
              )}
            />
            <Show when={!following()}>
              <Button size="icon" variant="outline" aria-label={text("scroll_to_bottom_2b05ff67")}
                class="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full shadow-lg" onClick={restoreFollowing}>
                <ChevronDown />
              </Button>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
