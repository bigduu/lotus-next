import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import { ArrowDown, LoaderCircle } from "@lucide/solid"
import type { SideChatQuote } from "@services/chat/sideChat"
import { appStore } from "@shared/store/appStore/state"
import type { UserMessage } from "@shared/types/chatMessages"
import { Button } from "../ui/button"
import { VirtualHistory, type HistoryReadingAnchor, type ScrollToHistoryEntry } from "../history/VirtualHistory"
import { createUiText } from "../shell/uiText"
import { MessageBody } from "./MessageBody"
import { RenderHistoryRow } from "./history/HistoryRow"
import { createSideChatSources } from "./history/SideChatSourceActions"
import { createHistoryReveal, type HistoryRevealRequest } from "./history/createHistoryReveal"
import { buildDisplayItems, buildHistoryEntries, buildLiveItems, buildRenderItems, collectSideChatSourceKeys, renderItemKey } from "./history/historyProjection"
import type { createChat } from "./createChat"
import { createMessageActions, type MessageNotice } from "./message-actions/createMessageActions"
import type { createRootModeAuthority } from "./model/createRootModeAuthority"

type Chat = ReturnType<typeof createChat>

export function ChatViewport(props: {
  chat: Chat
  theme: "light" | "dark"
  onOpenLink: (url: string) => void
  onPreviewImage: (url: string) => void
  initialReadingAnchor?: HistoryReadingAnchor | null
  onReadingAnchor?: (anchor: HistoryReadingAnchor | null) => void
  onAskSideChat?: (quote: SideChatQuote) => void
  revealMessage?: HistoryRevealRequest
  onMissingRevealedMessage?: () => void
  rootAuthority?: ReturnType<typeof createRootModeAuthority>
  onMessageNotice?: (notice: MessageNotice) => void
}) {
  const text = createUiText()
  const [loadingEarlier, setLoadingEarlier] = createSignal(false)
  const [earlierError, setEarlierError] = createSignal(false)
  const [following, setFollowing] = createSignal(untrack(() => !props.initialReadingAnchor))
  const [aligningSource, setAligningSource] = createSignal(false)
  const [openKeys, setOpenKeys] = createSignal<ReadonlySet<string>>(new Set())
  const disclosure = {
    isOpen: (key: string) => openKeys().has(key),
    toggle: (key: string) => setOpenKeys((previous) => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    }),
  }
  let viewport: HTMLDivElement | null = null
  let scrollToEntry: ScrollToHistoryEntry | undefined
  let loadRequest: { controller: AbortController; sessionId: string; done: Promise<void> } | undefined
  let pendingScroll: number | undefined
  let contentResize: ResizeObserver | undefined

  const rendering = createMemo(() => buildRenderItems(props.chat.messages))
  const live = createMemo(() => buildLiveItems(
    props.chat.liveSegments, props.chat.streaming, props.chat.streamingReasoning,
    props.chat.sending || props.chat.streamPhase === "streaming", props.chat.streamStatus, text,
  ))
  const tailCanFold = createMemo(() => !props.chat.sending && live().length === 0)
  const entries = createMemo(() => buildHistoryEntries(buildDisplayItems(rendering(), tailCanFold())))
  const sourceKeys = createMemo(() => props.onAskSideChat ? collectSideChatSourceKeys(entries(), !props.chat.sending) : new Set<string>())
  const sideChat = createSideChatSources(() => viewport, sourceKeys, () => props.onAskSideChat)
  const messageActions = createMessageActions({
    chat: props.chat, entries, viewport: () => viewport,
    rootAuthority: () => props.rootAuthority, onNotice: () => props.onMessageNotice,
  })
  const pending = createMemo(() => props.chat.pendingUserMessages.map((entry) => ({
    operationId: entry.operationId,
    message: {
      id: `pending-${entry.operationId}`, role: "user", content: entry.text, createdAt: "", images: [...entry.images],
    } satisfies UserMessage,
  })))
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
    if (viewport && !aligningSource()) setFollowing(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 24)
  }

  onSettled(() => {
    followTail()
    return () => {
      loadRequest?.controller.abort()
      contentResize?.disconnect()
      if (pendingScroll !== undefined) cancelAnimationFrame(pendingScroll)
    }
  })
  createEffect(() => [entries(), pending(), live()] as const, followTail)

  const loadEarlierPage = (sessionId: string): Promise<void> => {
    if (props.chat.currentSessionId !== sessionId || !before()) return Promise.resolve()
    if (loadRequest?.sessionId === sessionId) return loadRequest.done
    loadRequest?.controller.abort()
    const controller = new AbortController()
    setLoadingEarlier(true)
    setEarlierError(false)
    const done = appStore.getState().loadEarlierChatHistory(sessionId, controller.signal, () => setFollowing(false))
      .finally(() => {
        if (loadRequest?.controller !== controller) return
        loadRequest = undefined
        if (!controller.signal.aborted) setLoadingEarlier(false)
      })
    loadRequest = { controller, sessionId, done }
    return done
  }
  const loadEarlier = async () => {
    const sessionId = props.chat.currentSessionId
    if (!sessionId) return
    try {
      await loadEarlierPage(sessionId)
    } catch {
      if (props.chat.currentSessionId === sessionId) setEarlierError(true)
    }
  }
  createHistoryReveal({
    request: () => props.revealMessage,
    sessionId: () => props.chat.currentSessionId,
    entries, before,
    viewport: () => viewport,
    scrollTo: () => scrollToEntry,
    loadEarlier: loadEarlierPage,
    openTurn: (key) => setOpenKeys((previous) => previous.has(key) ? previous : new Set([...previous, key])),
    onAlign: (active) => {
      setAligningSource(active)
      if (active) setFollowing(false)
    },
    onMissing: () => props.onMissingRevealedMessage?.(),
  })

  return (
    <div data-chat-body="" class="relative flex min-h-0 min-w-0 flex-1">
      <VirtualHistory
        class="w-full"
        entries={entries()}
        estimateSize={({ key, item }) => {
          if (item.kind === "collapsedTurn") return disclosure.isOpen(key) ? 96 + item.items.length * 40 : 24
          if (item.kind === "process") return disclosure.isOpen(key) ? 96 + item.parts.length * 40 : 36
          return item.m.role === "user" ? 112 : 160
        }}
        preserveOnPrepend
        initialReadingAnchor={props.initialReadingAnchor}
        onReadingAnchor={props.onReadingAnchor}
        onMissingReadingAnchor={restoreFollowing}
        registerScrollToEntry={(scroll) => { scrollToEntry = scroll ?? undefined }}
        onScrollElement={(element) => {
          contentResize?.disconnect()
          viewport = element
          if (element?.firstElementChild) {
            contentResize = new ResizeObserver(followTail)
            contentResize.observe(element.firstElementChild)
          }
        }}
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
            <RenderHistoryRow item={entry().item} disclosure={disclosure} theme={props.theme}
              onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} sideChat={sideChat} messageActions={messageActions} />
          </div>
        )}
        after={
          <div class="mx-auto w-full max-w-4xl px-1 sm:px-4">
            <For each={pending()} keyed={(entry) => entry.operationId}>{(entry) => (
              <div data-pending-user-message="" data-pending-operation={entry().operationId}>
                <MessageBody message={entry().message} theme={props.theme}
                  onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} />
              </div>
            )}</For>
            <For each={live()} keyed={renderItemKey}>{(item) => (
              <RenderHistoryRow item={item()} disclosure={disclosure} theme={props.theme} live
                onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} />
            )}</For>
            <Show when={!props.chat.sending && props.chat.streamPhase !== "streaming" && props.chat.streamStatus}>
              <p class="py-1 text-xs text-muted-foreground" role="status">{props.chat.streamStatus}</p>
            </Show>
          </div>
        }
      />
      <Show when={messageActions.notice}>
        {(notice) => <p role={notice().error ? "alert" : "status"} class="absolute bottom-3 left-3 z-10 rounded-md border bg-popover px-3 py-2 text-sm">
          {notice().text}
        </p>}
      </Show>
      <Show when={!following()}>
        <div class="absolute bottom-3 right-4" data-scroll-to-bottom-anchor="">
          <Button size="icon" variant="outline" class="rounded-full"
            aria-label={text("scroll_to_bottom_2b05ff67")} onClick={restoreFollowing}>
            <ArrowDown />
          </Button>
        </div>
      </Show>
    </div>
  )
}
