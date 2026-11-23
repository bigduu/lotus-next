import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { ArrowDown, LoaderCircle } from "@lucide/solid"
import { messageOccurrenceKey } from "@shared/types/chatMessages"
import { appStore } from "@shared/store/appStore/state"
import { readLocalImage } from "@shared/services/FileOperationsService"
import { Button } from "../ui/button"
import { AssistantMarkdown } from "../markdown/AssistantMarkdown"
import { VirtualHistory } from "../history/VirtualHistory"
import { createUiText } from "../shell/uiText"
import { MessageBody } from "./MessageBody"
import type { createChat } from "./createChat"

type Chat = ReturnType<typeof createChat>

export function ChatViewport(props: {
  chat: Chat
  theme: "light" | "dark"
  onOpenLink: (url: string) => void
  onPreviewImage: (url: string) => void
}) {
  const text = createUiText()
  const [loadingEarlier, setLoadingEarlier] = createSignal(false)
  const [earlierError, setEarlierError] = createSignal(false)
  const [following, setFollowing] = createSignal(true)
  let viewport: HTMLDivElement | null = null
  let loadRequest: AbortController | undefined
  let pendingScroll: number | undefined

  const messages = createMemo(() => props.chat.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ key: messageOccurrenceKey(message), message })))
  const before = () => {
    const window = props.chat.currentChat?.historyWindow
    return window && !window.invalidated ? window.beforeMessageId : null
  }

  const followTail = () => {
    if (!viewport || pendingScroll !== undefined) return
    pendingScroll = requestAnimationFrame(() => {
      pendingScroll = undefined
      if (following() && viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }
  const restoreFollowing = () => { setFollowing(true); followTail() }
  const onScroll = () => {
    if (viewport) setFollowing(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 24)
  }

  onSettled(() => {
    followTail()
    return () => {
      loadRequest?.abort()
      if (pendingScroll !== undefined) cancelAnimationFrame(pendingScroll)
    }
  })
  createEffect(() => [messages(), props.chat.streaming, props.chat.liveSegments] as const, followTail)

  const loadEarlier = async () => {
    const sessionId = props.chat.currentSessionId
    if (!sessionId || !before() || loadRequest) return
    const request = new AbortController()
    loadRequest = request
    setLoadingEarlier(true)
    setEarlierError(false)
    try {
      await appStore.getState().loadEarlierChatHistory(sessionId, request.signal, () => setFollowing(false))
    } catch {
      if (!request.signal.aborted) setEarlierError(true)
    } finally {
      if (loadRequest === request) loadRequest = undefined
      if (!request.signal.aborted) setLoadingEarlier(false)
    }
  }

  const assistant = (content: () => string, streaming = false) => (
    <AssistantMarkdown theme={props.theme} isStreaming={streaming} text={text}
      onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} readImage={readLocalImage}>
      {content()}
    </AssistantMarkdown>
  )

  return (
    <div data-chat-body="" class="relative flex min-h-0 min-w-0 flex-1">
      <VirtualHistory
        class="w-full"
        entries={messages()}
        estimateSize={() => 96}
        preserveOnPrepend
        onScrollElement={(element) => { viewport = element }}
        onScroll={onScroll}
        before={<Show when={before()}>
          <div class="mx-auto flex w-full max-w-4xl flex-col items-center pb-3">
            <Button variant="ghost" size="sm" disabled={loadingEarlier()} onClick={() => { void loadEarlier() }}>
              <Show when={loadingEarlier()}><LoaderCircle class="size-4 animate-spin" /></Show>
              {text("load_earlier_messages")}
            </Button>
            <Show when={earlierError()}><p role="alert" class="text-xs text-destructive">{text("load_earlier_messages_failed")}</p></Show>
          </div>
        </Show>}
        renderEntry={(entry) => (
          <div class="mx-auto w-full max-w-4xl px-1 sm:px-4">
            <MessageBody message={entry().message} theme={props.theme}
              onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} />
          </div>
        )}
        after={
          <div class="mx-auto w-full max-w-4xl px-1 sm:px-4">
            <For each={props.chat.pendingUserMessages} keyed={(entry) => entry.operationId}>{(entry) => (
              <div data-message-role="user" class="ml-auto mt-2 w-fit max-w-full whitespace-pre-wrap rounded-2xl px-4 py-2.5"
                style={{ background: "var(--user-message-background)", color: "var(--user-message-foreground)" }}>
                {entry().text}
              </div>
            )}</For>
            <For each={props.chat.liveSegments} keyed={false}>{(segment) => (
              <Show when={segment().kind === "text"} fallback={
                <For each={segment().kind === "tools" ? (segment() as Extract<Chat["liveSegments"][number], { kind: "tools" }>).calls : []}
                  keyed={(call) => call.toolCallId}>{(call) => (
                    <details class="rounded-md border px-2 py-1 text-sm text-muted-foreground">
                      <summary>{call().toolName}</summary>
                      <pre class="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{call().output}</pre>
                    </details>
                  )}</For>
              }>
                {assistant(() => {
                  const current = segment()
                  return current.kind === "text" ? current.text : ""
                })}
              </Show>
            )}</For>
            <Show when={props.chat.streaming}>{(content) => assistant(content, true)}</Show>
            <Show when={props.chat.streamStatus}>
              <p class="py-1 text-xs text-muted-foreground" role="status">{props.chat.streamStatus}</p>
            </Show>
          </div>
        }
      />
      <Show when={!following()}>
        <Button size="icon" variant="outline" class="absolute bottom-3 right-4 rounded-full"
          aria-label={text("scroll_to_bottom_2b05ff67")} onClick={restoreFollowing}>
          <ArrowDown />
        </Button>
      </Show>
    </div>
  )
}
