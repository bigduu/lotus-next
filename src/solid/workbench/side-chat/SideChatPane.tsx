import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { ArrowUpRight, MessageSquarePlus, RotateCcw, Square, X } from "@lucide/solid"
import { isApiError } from "@services/api/errors"
import {
  newSideChatRequestId, sideChatClient, sideChatQuestionFits,
  type SideChatQuote, type SideChatSnapshot, type SideChatSource, type SideChatTurn, type SideChatTurnRequest,
} from "@services/chat/sideChat"
import { readLocalImage } from "@shared/services/FileOperationsService"
import { AssistantMarkdown } from "../../markdown/AssistantMarkdown"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Textarea } from "../../ui/textarea"

type PendingSend = Pick<SideChatTurnRequest, "id" | "source_generation" | "expected_chat_id" | "previous_turn_id">
type Draft = {
  text: string
  quote?: SideChatQuote
  chatId?: string
  sourceGeneration?: string
  pending?: PendingSend
}
type Preview = { chatId: string; runId: string; text: string }
type Operation = "send" | "stop"
type SourceIdentity = { sourceId: string; scope: string }
export type SideChatIntent = { prompt?: string; quote?: SideChatQuote; onApplied?: () => void }
export type PendingSideChatIntent = SideChatIntent & { token: number }
export type SideChatPaneProps = SourceIdentity & {
  active: boolean
  intent?: PendingSideChatIntent
  onConsumeIntent: (token: number) => void
  onQuoteToMain: (text: string) => void
  onRevealSource: (id: string) => void
  theme?: "light" | "dark"
  onOpenLink?: (url: string) => void
  onPreviewImage?: (src: string) => void
}

const EMPTY_DRAFT: Draft = { text: "" }

function loadDraft(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Draft | null
    return value && typeof value.text === "string" ? value : EMPTY_DRAFT
  } catch {
    return EMPTY_DRAFT
  }
}

function saveDraft(key: string, value: Draft) {
  try {
    if (!value.text && !value.quote) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage failure only limits draft persistence.
  }
}

function acknowledges(chat: SideChatSnapshot | null | undefined, pending: PendingSend) {
  return Boolean(chat && (pending.expected_chat_id === null || chat.id === pending.expected_chat_id)
    && chat.turns.some((turn) => turn.id === pending.id))
}

/** Each source/workbench scope owns its own subscription and draft. */
export function SideChatPane(props: SideChatPaneProps) {
  const identity = createMemo(() => ({ sourceId: props.sourceId, scope: props.scope }), {
    equals: (before, after) => before?.sourceId === after.sourceId && before?.scope === after.scope,
  })
  return <Show when={identity()} keyed>
    {(source) => <SourcePane identity={source} options={props} />}
  </Show>
}

function SourcePane(props: { identity: SourceIdentity; options: SideChatPaneProps }) {
  const text = createUiText()
  const { sourceId, scope } = props.identity
  const options = () => props.options
  const draftKey = scope + ":side-chat-draft"
  let editing = loadDraft(draftKey)
  const [draft, setDraft] = createSignal(editing)
  const [source, setSource] = createSignal<SideChatSource>()
  const [preview, setPreview] = createSignal<Preview | null>(null)
  const [readFailed, setReadFailed] = createSignal(false)
  const [operation, setOperation] = createSignal<Operation | null>(null)
  const [problem, setProblem] = createSignal<Operation | null>(null)
  const [quoted, setQuoted] = createSignal(false)
  const lifetime = new AbortController()
  let readRequest: AbortController | undefined
  let busy = false
  let editor: HTMLTextAreaElement | undefined
  let transcript: HTMLDivElement | undefined
  let tail = true
  let consumed: number | undefined

  const alive = () => !lifetime.signal.aborted
  const snapshot = () => source()?.side_chat
  const generation = () => source()?.source_generation
  const last = () => snapshot()?.turns.at(-1)
  const running = () => last()?.status === "running"
  const previewText = () => {
    const chat = snapshot()
    const turn = last()
    const progress = preview()
    return progress && chat?.id === progress.chatId && turn?.id === progress.runId
      && progress.text.length >= chat.preview.length ? progress.text : chat?.preview
  }
  const changeDraft = (next: Draft) => {
    editing = next
    setDraft(next)
    saveDraft(draftKey, next)
  }

  const refresh = async () => {
    if (!alive()) return
    readRequest?.abort()
    const request = new AbortController()
    readRequest = request
    try {
      const current = await sideChatClient.read(sourceId, request.signal)
      if (!alive() || request.signal.aborted) return
      const { side_chat: chat, source_generation: observed } = current
      const pending = editing.pending
      if (pending?.source_generation === observed && acknowledges(chat, pending)) {
        changeDraft(EMPTY_DRAFT)
      } else if ((editing.sourceGeneration && editing.sourceGeneration !== observed)
        || (editing.chatId && editing.chatId !== chat?.id)
        || (pending && pending.source_generation !== observed)) {
        // Keep user text and retire a reference or delivery identity tied to a replaced source.
        changeDraft({ text: editing.text, sourceGeneration: observed, chatId: chat?.id })
      }
      setSource(current)
      setReadFailed(false)
      const tail = chat?.turns.at(-1)
      setPreview((progress) => progress && chat?.id === progress.chatId
        && tail?.id === progress.runId && tail.status === "running" ? progress : null)
    } catch {
      if (alive() && !request.signal.aborted) setReadFailed(true)
    }
  }

  onSettled(() => {
    const close = sideChatClient.subscribe(sourceId, () => { void refresh() }, (chatId, runId, text) => {
      if (!alive()) return
      setPreview((current) => current?.chatId === chatId && current.runId === runId
        && current.text.length > text.length ? current : { chatId, runId, text })
    })
    void refresh()
    return () => {
      lifetime.abort()
      readRequest?.abort()
      close()
    }
  })

  createEffect(
    () => [options().active, options().intent, draft().pending, generation(),
      readFailed(), snapshot()?.id, options().onConsumeIntent] as const,
    ([active, intent, pending, generation, failed, chatId, onConsumeIntent]) => {
      if (!active || !intent || intent.token === consumed) return
      if (intent.prompt || intent.quote) {
        if (!generation || failed || pending) return
        const content = intent.prompt ? [editing.text, intent.prompt].filter(Boolean).join("\n\n") : editing.text
        changeDraft({ text: content, quote: intent.quote ?? editing.quote, sourceGeneration: generation, chatId })
      } else if (failed && !busy) {
        void refresh()
      }
      consumed = intent.token
      intent.onApplied?.()
      onConsumeIntent(intent.token)
    },
  )
  createEffect(
    () => [options().active, options().intent?.token] as const,
    ([active]) => {
      if (!active) return
      const frame = requestAnimationFrame(() => { editor?.focus() })
      return () => cancelAnimationFrame(frame)
    },
  )
  createEffect(
    () => [options().active, snapshot(), previewText()] as const,
    ([active]) => {
      if (active && transcript && tail) transcript.scrollTop = transcript.scrollHeight
    },
  )

  const finish = async () => {
    if (alive()) {
      await refresh()
      if (alive()) setOperation(null)
    }
    busy = false
  }

  const submit = async (retry = false) => {
    const before = editing
    const question = before.text.trim()
    const origin = generation()
    const previous = last()
    if (!alive() || !options().active || busy || running() || readFailed() || !origin
      || (retry ? !previous || previous.status === "completed" : !question || !sideChatQuestionFits(question))) return
    let identity: PendingSend
    try {
      identity = (!retry ? before.pending : undefined) ?? {
        id: newSideChatRequestId(),
        source_generation: origin,
        expected_chat_id: snapshot()?.id ?? null,
        previous_turn_id: previous?.id ?? null,
      }
    } catch {
      setProblem("send")
      return
    }
    busy = true
    setOperation("send")
    setProblem(null)
    tail = true
    const submitted = { ...before, sourceGeneration: origin, pending: identity }
    if (!retry) changeDraft(submitted)
    const clearAcknowledged = () => {
      if (!retry && editing === submitted) changeDraft(EMPTY_DRAFT)
    }
    try {
      const result = await sideChatClient.start(sourceId, {
        ...identity, ...(retry ? {} : { message: question, quote: before.quote }),
      })
      if (!alive()) return
      if (!acknowledges(result, identity)) throw new Error("The Side Chat turn was not acknowledged")
      clearAcknowledged()
    } catch (error) {
      if (!alive()) return
      // A dropped response may follow successful admission. Reconcile the exact turn first.
      try {
        const current = await sideChatClient.read(sourceId, lifetime.signal)
        if (!alive()) return
        if (current.source_generation === identity.source_generation && acknowledges(current.side_chat, identity)) {
          clearAcknowledged()
        } else {
          if (!retry && editing === submitted && isApiError(error)
            && error.status >= 400 && error.status < 500 && error.status !== 408) {
            changeDraft({ ...before, pending: undefined })
          }
          setProblem("send")
        }
      } catch {
        if (alive()) setProblem("send")
      }
    } finally {
      await finish()
    }
  }

  const stop = async () => {
    const chat = snapshot()
    const turn = last()
    if (!alive() || !options().active || !chat || !turn || !running() || busy) return
    busy = true
    setOperation("stop")
    setProblem(null)
    try {
      await sideChatClient.stop(sourceId, chat.id, turn.id)
    } catch {
      if (alive()) setProblem("stop")
    } finally {
      await finish()
    }
  }

  const quoteToMain = (answer: string, button: HTMLButtonElement) => {
    const selection = document.getSelection()
    const body = button.parentElement?.querySelector("[data-side-chat-answer]")
    const selected = selection && body?.contains(selection.anchorNode) && body.contains(selection.focusNode)
      ? selection.toString().trim() : ""
    options().onQuoteToMain(selected || answer)
    setQuoted(true)
  }
  const changeText = (value: string) => {
    setQuoted(false)
    changeDraft({
      text: value,
      quote: editing.quote,
      chatId: snapshot()?.id ?? editing.chatId,
      sourceGeneration: generation() ?? editing.sourceGeneration,
    })
  }
  const removeQuote = () => {
    changeDraft({ text: editing.text, chatId: editing.chatId, sourceGeneration: editing.sourceGeneration })
  }
  const fits = () => sideChatQuestionFits(draft().text.trim())

  return (
    <section aria-label={text("side_chat_title")} class="flex min-h-0 min-w-0 flex-1 flex-col" data-side-chat="">
      <div ref={(element) => { transcript = element }} class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" onScroll={(event) => {
        const node = event.currentTarget
        tail = node.scrollHeight - node.scrollTop - node.clientHeight < 64
      }}>
        <Show when={snapshot() === undefined && !readFailed()}>
          <p role="status" class="text-sm text-muted-foreground">{text("side_chat_loading")}</p>
        </Show>
        <Show when={snapshot() === null && !readFailed()}>
          <p class="text-sm text-muted-foreground">{text("side_chat_empty")}</p>
        </Show>
        <Show when={readFailed()}>
          <div role="alert" class="text-sm text-destructive">
            {text("side_chat_read_failed")}
            <Button type="button" variant="ghost" size="sm" onClick={() => { void refresh() }}>{text("retry_b8784c8d")}</Button>
          </div>
        </Show>
        <For each={snapshot()?.turns} keyed={(turn: SideChatTurn) => turn.id}>
          {(turn) => <article class="space-y-2">
            <div class="user-message-surface ml-auto w-fit max-w-[90%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              <Show when={turn().quote}>
                {(quote) => <button type="button" onClick={() => options().onRevealSource(quote().message_id)}
                  class="mb-2 flex max-w-full items-center gap-1.5 text-left text-xs hover:underline"
                  title={quote().text} aria-label={text("side_chat_reveal_source")}>
                  <span class="line-clamp-2">{quote().text}</span><ArrowUpRight class="size-3.5 shrink-0" />
                </button>}
              </Show>
              {turn().message}
            </div>
            <Show when={turn().answer}>
              {(answer) => <div class="min-w-0 space-y-1 text-sm">
                <div data-side-chat-answer="">
                  <AssistantMarkdown theme={options().theme} text={text} readImage={readLocalImage}
                    onOpenLink={options().onOpenLink} onPreviewImage={options().onPreviewImage}>{answer()}</AssistantMarkdown>
                </div>
                <Button type="button" size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => quoteToMain(answer(), event.currentTarget)}>
                  <MessageSquarePlus class="size-3.5" />{text("side_chat_quote_to_main")}
                </Button>
              </div>}
            </Show>
            <Show when={turn().status === "running"} fallback={
              <Show when={turn().status !== "completed"}>
                <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {text(turn().status === "stopped" ? "side_chat_stopped" : "side_chat_answer_failed")}
                  <Show when={turn().id === last()?.id}>
                    <Button type="button" size="sm" variant="ghost" disabled={Boolean(operation()) || readFailed()}
                      onClick={() => { void submit(true) }}>
                      <RotateCcw class="size-3.5" />{text("retry_b8784c8d")}
                    </Button>
                  </Show>
                </div>
              </Show>
            }>
              <div class="min-w-0 text-sm">
                <Show when={previewText()} fallback={<p role="status" class="text-muted-foreground">{text("side_chat_answering")}</p>}>
                  {(value) => <AssistantMarkdown isStreaming theme={options().theme} text={text} readImage={readLocalImage}
                    onOpenLink={options().onOpenLink} onPreviewImage={options().onPreviewImage}>{value()}</AssistantMarkdown>}
                </Show>
              </div>
            </Show>
          </article>}
        </For>
      </div>
      <form class="shrink-0 space-y-2 border-t px-3 py-3" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <Show when={draft().quote}>
          {(quote) => <div class="flex items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-muted-foreground">
            <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
              onClick={() => options().onRevealSource(quote().message_id)} aria-label={text("side_chat_reveal_source")} title={quote().text}>
              <span class="truncate">{quote().text}</span><ArrowUpRight class="size-3.5 shrink-0" />
            </button>
            <Button type="button" size="icon" variant="ghost" class="size-7" aria-label={text("side_chat_remove_quote")} onClick={removeQuote}>
              <X class="size-3.5" />
            </Button>
          </div>}
        </Show>
        <Textarea ref={(element) => { editor = element }} rows={2} class="min-h-16 resize-none" value={draft().text}
          aria-label={text("side_chat_question")} placeholder={text("side_chat_question")}
          onInput={(event) => changeText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
              event.preventDefault()
              void submit()
            }
          }} />
        <Show when={problem() || !fits()}>
          <p role="alert" class="text-xs text-destructive">
            {text(problem() === "stop" ? "side_chat_stop_failed" : problem() === "send" ? "side_chat_send_failed" : "side_chat_question_too_long")}
          </p>
        </Show>
        <div class="flex min-h-8 items-center justify-end gap-2">
          <Show when={quoted()}><span role="status" class="mr-auto text-xs text-muted-foreground">{text("side_chat_added_to_draft")}</span></Show>
          <Show when={running()} fallback={
            <Button type="submit" size="sm" disabled={Boolean(operation()) || readFailed() || snapshot() === undefined
              || !draft().text.trim() || !fits()}>{text("side_chat_send")}</Button>
          }>
            <Button type="button" size="sm" variant="secondary" disabled={Boolean(operation())} onClick={() => { void stop() }}>
              <Square class="size-3.5" />{text("side_chat_stop")}
            </Button>
          </Show>
        </div>
      </form>
    </section>
  )
}
