import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import { ArrowDown, LoaderCircle } from "@lucide/solid"
import type { SideChatQuote } from "@services/chat/sideChat"
import { appStore } from "@shared/store/appStore/state"
import type { UserMessage } from "@shared/types/chatMessages"
import { renderProbe } from "@/lib/renderProbe"
import { BrandMark } from "../ui/brand-mark"
import { Button } from "../ui/button"
import { VirtualHistory, type HistoryReadingAnchor, type ScrollToHistoryEntry } from "../history/VirtualHistory"
import { createUiText } from "../shell/uiText"
import { MessageBody } from "./MessageBody"
import { InlineActorGroup, InlineActorPrefix } from "./actor-status/InlineActorStatus"
import { createInlineActorStatus } from "./actor-status/createInlineActorStatus"
import { RenderHistoryRow } from "./history/HistoryRow"
import { createSideChatSources } from "./history/SideChatSourceActions"
import { createHistoryReveal, type HistoryRevealRequest } from "./history/createHistoryReveal"
import { createStickyHistoryFollow } from "./history/createStickyHistoryFollow"
import { buildDisplayItems, buildHistoryEntries, buildLiveItems, buildRenderItems, collectSideChatSourceKeys, renderItemKey } from "./history/historyProjection"
import type { createChat } from "./createChat"
import { createMessageActions, type MessageNotice } from "./message-actions/createMessageActions"
import type { createRootModeAuthority } from "./model/createRootModeAuthority"
import { placeTimelineAttachments, type TimelineAttachment, type TimelineHistoryEntry } from "./interactions/timelineAttachments"
import { transcriptWorkWait } from "./status/transcriptWorkWait"

type Chat = ReturnType<typeof createChat>

const savedHistoryContentReady = (viewport: HTMLDivElement) =>
  !viewport.querySelector("[data-virtual-history] [data-assistant-markdown-fallback]")

export function ChatViewport(props: {
  chat: Chat
  theme: "light" | "dark"
  onOpenLink: (url: string) => void
  onPreviewImage: (url: string) => void
  initialReadingAnchor?: HistoryReadingAnchor | null
  onReadingAnchor?: (anchor: HistoryReadingAnchor | null) => void
  followRequest?: object | null
  onAskSideChat?: (quote: SideChatQuote) => void
  revealMessage?: HistoryRevealRequest
  onMissingRevealedMessage?: () => void
  rootAuthority?: ReturnType<typeof createRootModeAuthority>
  onMessageNotice?: (notice: MessageNotice) => void
  onForking?: (active: boolean) => void
  attachments?: readonly TimelineAttachment[]
  pageVisible?: boolean
  onOpenActor?: (id: string) => void
}) {
  const text = createUiText()
  const [loadingEarlier, setLoadingEarlier] = createSignal(false)
  const [earlierError, setEarlierError] = createSignal(false)
  const sticky = createStickyHistoryFollow(untrack(() => !props.initialReadingAnchor))
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
  let captureBeforePrepend: (() => void) | undefined
  let loadRequest: { controller: AbortController; sessionId: string; done: Promise<void> } | undefined

  const rendering = createMemo(() => {
    renderProbe.count("app.MessageList")
    return buildRenderItems(props.chat.messages)
  })
  const wait = createMemo(() => transcriptWorkWait(props.chat))
  const showCommandWait = () => !props.chat.streaming && wait().command
  const live = createMemo(() => {
    renderProbe.count("app.MessageList")
    return buildLiveItems(
      props.chat.liveSegments, props.chat.streaming, props.chat.streamingReasoning,
      !showCommandWait() && (props.chat.sending || props.chat.streamPhase === "streaming" || wait().yielded),
      wait().delegationHint ? text("process_waiting_for_subagents") : props.chat.streamStatus, text,
    )
  })
  const actorStatus = createInlineActorStatus({
    session: () => props.chat.currentChat, chats: () => props.chat.chats, active: () => props.pageVisible !== false,
    history: rendering, live, messages: () => props.chat.messages,
  })
  const afterProcess = (key: string) => <InlineActorGroup agents={actorStatus.groups().byOrigin.get(key)}
    status={actorStatus} onOpen={props.onOpenActor} />
  const tailCanFold = createMemo(() => !props.chat.sending && !wait().yielded && live().length === 0)
  const entries = createMemo(() => buildHistoryEntries(buildDisplayItems(rendering(), tailCanFold())))
  const timeline = createMemo(() => placeTimelineAttachments(entries(), props.attachments))
  const sourceKeys = createMemo(() => props.onAskSideChat
    ? collectSideChatSourceKeys(entries(), !props.chat.sending && !wait().yielded) : new Set<string>())
  const sideChat = createSideChatSources(() => viewport, sourceKeys, () => props.onAskSideChat)
  const messageActions = createMessageActions({
    chat: props.chat, entries, viewport: () => viewport,
    rootAuthority: () => props.rootAuthority, onNotice: () => props.onMessageNotice, onForking: () => props.onForking,
  })
  const pending = createMemo(() => props.chat.pendingUserMessages.map((entry) => ({
    operationId: entry.operationId,
    message: {
      id: `pending-${entry.operationId}`, role: "user", content: entry.text, createdAt: "", images: [...entry.images],
    } satisfies UserMessage,
  })))
  const emptyTranscript = () => Boolean(props.chat.currentChat?.config.syncCursor)
    && !props.chat.messages.some((message) => message.role !== "system")
    && !pending().length && !props.chat.streaming && !live().length && !wait().yielded
  const before = () => {
    const window = props.chat.currentChat?.historyWindow
    return window && !window.invalidated ? window.beforeMessageId : null
  }

  onSettled(() => () => loadRequest?.controller.abort())
  createEffect(() => [entries(), pending(), live(), timeline()] as const, sticky.follow)
  createEffect(() => props.followRequest, (request) => {
    if (request) sticky.resume()
  })

  const loadEarlierPage = (sessionId: string, preserveReading = false): Promise<void> => {
    if (props.chat.currentSessionId !== sessionId || !before()) return Promise.resolve()
    if (loadRequest?.sessionId === sessionId) return loadRequest.done
    loadRequest?.controller.abort()
    const controller = new AbortController()
    setLoadingEarlier(true)
    setEarlierError(false)
    const done = appStore.getState().loadEarlierChatHistory(sessionId, controller.signal, () => {
      sticky.pause()
      if (preserveReading && !aligningSource()) captureBeforePrepend?.()
    })
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
      await loadEarlierPage(sessionId, true)
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
      if (active) sticky.pause()
    },
    onMissing: () => props.onMissingRevealedMessage?.(),
  })

  return (
    <div class="relative flex min-h-0 min-w-0 flex-1">
      <VirtualHistory
        class="w-full"
        entries={timeline().entries}
        estimateSize={(entry) => {
          if ("attachment" in entry) return 132
          const { key, item } = entry
          if (item.kind === "collapsedTurn") return disclosure.isOpen(key) ? 96 + item.items.length * 40 : 24
          if (item.kind === "process") return disclosure.isOpen(key) ? 96 + item.parts.length * 40 : 36
          return item.m.role === "user" ? 112 : 160
        }}
        preserveOnPrepend
        followingLatest={sticky.following()}
        initialContentReady={emptyTranscript() || props.chat.sending || props.pageVisible === false
          ? undefined : savedHistoryContentReady}
        initialReadingAnchor={props.initialReadingAnchor}
        onReadingAnchor={props.onReadingAnchor}
        onMissingReadingAnchor={sticky.resume}
        registerScrollToEntry={(scroll) => { scrollToEntry = scroll ?? undefined }}
        registerCaptureBeforePrepend={(capture) => { captureBeforePrepend = capture ?? undefined }}
        onScrollElement={(element) => {
          viewport = element
          sticky.bind(element)
        }}
        onScroll={() => { if (!aligningSource()) sticky.onScroll() }}
        before={<>
          <Show when={before()}>
            <div class="mx-auto flex w-full flex-col items-center pb-3">
              <Button variant="ghost" size="sm" disabled={loadingEarlier()} onClick={() => { void loadEarlier() }}>
                <Show when={loadingEarlier()}><LoaderCircle class="size-4 animate-spin" /></Show>
                {text("load_earlier_messages")}
              </Button>
              <Show when={earlierError()}><p role="alert" class="text-xs text-destructive">{text("load_earlier_messages_failed")}</p></Show>
            </div>
          </Show>
          <InlineActorPrefix status={actorStatus} onOpen={props.onOpenActor} />
          <Show when={emptyTranscript()}>
            <div class="flex flex-col items-center gap-2 py-20 text-center">
              <BrandMark class="size-10" />
              <p class="text-sm text-muted-foreground">{text("start_a_new_conversation_bab6ab18")}</p>
            </div>
          </Show>
        </>}
        renderEntry={(entry) => {
          const attachment = () => {
            const row = entry()
            return row && "attachment" in row ? row.attachment : null
          }
          const item = () => {
            const row: TimelineHistoryEntry = entry()
            return row && "item" in row ? row.item : undefined
          }
          return <Show when={attachment()} fallback={
            <Show when={item()}>{(message) => (
              <div class="w-full">
                <RenderHistoryRow item={message()} disclosure={disclosure} theme={props.theme}
                  onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} sideChat={sideChat} messageActions={messageActions} afterProcess={afterProcess} />
              </div>
            )}</Show>
          }>{(card) => <>{card().render()}</>}</Show>
        }}
        after={
          <div class="w-full">
            <For each={pending()} keyed={(entry) => entry.operationId}>{(entry) => (
              <div data-pending-user-message="" data-pending-operation={entry().operationId}>
                <MessageBody message={entry().message} theme={props.theme}
                  onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} />
              </div>
            )}</For>
            <For each={live()} keyed={renderItemKey}>{(item) => (
              <RenderHistoryRow item={item()} disclosure={disclosure} theme={props.theme} live afterProcess={afterProcess}
                onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} />
            )}</For>
            <Show when={timeline().tail.length}>
              <div class="flex flex-col gap-2">
                <For each={timeline().tail} keyed={(attachment) => attachment.key}>{(attachment) => <>{attachment().render()}</>}</For>
              </div>
            </Show>
            <Show when={showCommandWait()}>
              <p role="status" class="flex items-center gap-2 px-1 py-1 text-sm text-muted-foreground">
                <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
                {text("runtime_notice_background_exec_running_93d0e2c1")}
              </p>
            </Show>
            <Show when={!wait().yielded && !props.chat.sending && props.chat.streamPhase !== "streaming" && props.chat.streamStatus}>
              <p class="py-1 text-xs text-muted-foreground" role="status">{props.chat.streamStatus}</p>
            </Show>
          </div>
        }
      />
      <Show when={messageActions.notice}>
        {(notice) => <div class="pointer-events-none absolute inset-x-0 bottom-3 z-10 mx-auto w-[calc(100%-1.5rem)] max-w-6xl">
          <p role={notice().error ? "alert" : "status"} class="pointer-events-auto w-fit max-w-full break-words rounded-md border bg-popover px-3 py-2 text-sm">
            {notice().text}
          </p>
        </div>}
      </Show>
      <Show when={!sticky.following()}>
        <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto flex w-[calc(100%-1.5rem)] max-w-6xl translate-y-1/2 justify-center" data-scroll-to-bottom-anchor="">
          <Button size="icon" variant="outline" class="pointer-events-auto rounded-full bg-card text-muted-foreground shadow-lg"
            aria-label={text("scroll_to_bottom_2b05ff67")} onClick={sticky.resume}>
            <ArrowDown />
          </Button>
        </div>
      </Show>
    </div>
  )
}
