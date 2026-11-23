import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowUpRight, MessageSquarePlus, RotateCcw, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AssistantMarkdown } from "@/components/chat/AssistantMarkdown"
import { isApiError } from "@services/api"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { sideChatClient, sideChatQuestionFits, type SideChatQuote, type SideChatSnapshot, type SideChatTurnRequest } from "@services/chat/sideChat"

type PendingSend = Pick<SideChatTurnRequest, "id" | "expected_chat_id" | "previous_turn_id">
type Draft = { text: string; quote?: SideChatQuote; chatId?: string; pending?: PendingSend }
const EMPTY_DRAFT: Draft = { text: "" }
type Preview = { chatId: string; runId: string; text: string }
export type SideChatIntent = { prompt?: string; quote?: SideChatQuote; onApplied?: () => void }
export type PendingSideChatIntent = SideChatIntent & { token: number }

function loadDraft(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Draft | null
    return value && typeof value.text === "string" ? value : EMPTY_DRAFT
  } catch {
    return EMPTY_DRAFT
  }
}

function saveDraft(key: string, draft: Draft) {
  try {
    if (!draft.text && !draft.quote) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // An unavailable browser store should still allow composing in this pane.
  }
}

export function SideChatPane({ sourceId, scope, active, intent, onConsumeIntent, onQuoteToMain, onRevealSource }: {
  sourceId: string
  scope: string
  active: boolean
  intent?: PendingSideChatIntent
  onConsumeIntent: (token: number) => void
  onQuoteToMain: (text: string) => void
  onRevealSource: (id: string) => void
}) {
  useUiLocale()
  const draftKey = scope + ":side-chat-draft"
  const [draft, setDraft] = useState(() => loadDraft(draftKey))
  const draftRef = useRef(draft)
  const [snapshot, setSnapshot] = useState<SideChatSnapshot | null | undefined>()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const [operation, setOperation] = useState<"send" | "stop" | null>(null)
  const [problem, setProblem] = useState<"send" | "stop" | null>(null)
  const [quoted, setQuoted] = useState(false)
  const persisted = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const busy = useRef(false)
  const editor = useRef<HTMLTextAreaElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const tail = useRef(true)

  const changeDraft = useCallback((value: Draft) => {
    draftRef.current = value
    setDraft(value)
    saveDraft(draftKey, value)
  }, [draftKey])

  const refresh = useCallback(async () => {
    persisted.current?.abort()
    const request = new AbortController()
    persisted.current = request
    try {
      const chat = await sideChatClient.read(sourceId, request.signal)
      if (!mounted.current || request.signal.aborted) return
      const editing = draftRef.current
      const admitted = editing.pending && chat?.turns.some((turn) => turn.id === editing.pending?.id)
      if (admitted || (editing.chatId && editing.chatId !== chat?.id)) changeDraft(EMPTY_DRAFT)
      setSnapshot(chat)
      setReadFailed(false)
      setPreview((current) => current && chat?.id === current.chatId
        && chat.turns.at(-1)?.id === current.runId && chat.turns.at(-1)?.status === "running" ? current : null)
    } catch {
      if (mounted.current && !request.signal.aborted) setReadFailed(true)
    }
  }, [changeDraft, sourceId])

  useEffect(() => {
    mounted.current = true
    const close = sideChatClient.subscribe(sourceId, () => void refresh(), (chatId, runId, text) => {
      setPreview((current) => current?.chatId === chatId && current.runId === runId
        && current.text.length > text.length ? current : { chatId, runId, text })
    })
    void refresh()
    return () => {
      mounted.current = false
      persisted.current?.abort()
      close()
    }
  }, [refresh, sourceId])

  const last = snapshot?.turns.at(-1)
  const running = last?.status === "running"
  const previewText = snapshot?.id === preview?.chatId && last?.id === preview?.runId
    && (preview?.text.length ?? 0) >= (snapshot?.preview.length ?? 0) ? preview?.text : snapshot?.preview
  const consumed = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!active || !intent || intent.token === consumed.current) return
    consumed.current = intent.token
    const previous = draftRef.current
    const text = intent.prompt ? [previous.text, intent.prompt].filter(Boolean).join("\n\n") : previous.text
    changeDraft({ text, quote: intent.quote ?? previous.quote, chatId: snapshot?.id ?? previous.chatId })
    intent.onApplied?.()
    onConsumeIntent(intent.token)
  }, [active, changeDraft, intent, onConsumeIntent, snapshot?.id])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => editor.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [active, intent?.token])

  useEffect(() => {
    if (active && transcript.current && tail.current) transcript.current.scrollTop = transcript.current.scrollHeight
  }, [active, snapshot, previewText])

  const submit = async (event?: FormEvent, retry = false) => {
    event?.preventDefault()
    const before = draftRef.current
    const question = before.text.trim()
    if (busy.current || running || readFailed || snapshot === undefined
      || (retry ? !last || last.status === "completed" : !question || !sideChatQuestionFits(question))) return
    busy.current = true
    setOperation("send")
    setProblem(null)
    tail.current = true
    const identity = (!retry ? before.pending : undefined) ?? {
      id: crypto.randomUUID(), expected_chat_id: snapshot?.id ?? null, previous_turn_id: last?.id ?? null,
    }
    const submitted = { ...before, pending: identity }
    if (!retry) changeDraft(submitted)
    try {
      await sideChatClient.start(sourceId, {
        ...identity, ...(retry ? {} : { message: question, quote: before.quote }),
      })
      if (!mounted.current) return
      if (!retry && draftRef.current === submitted) changeDraft(EMPTY_DRAFT)
    } catch (error) {
      if (!mounted.current) return
      // A request can disconnect after the server admitted it. Recover by
      // exact identity before offering another send.
      try {
        const current = await sideChatClient.read(sourceId)
        if (!mounted.current) return
        if (current?.turns.some((turn) => turn.id === identity.id)) {
          if (!retry && draftRef.current === submitted) changeDraft(EMPTY_DRAFT)
        } else {
          if (!retry && draftRef.current === submitted && isApiError(error)
            && error.status >= 400 && error.status < 500 && error.status !== 408) changeDraft({ ...before, pending: undefined })
          setProblem("send")
        }
      } catch {
        if (mounted.current) setProblem("send")
      }
    } finally {
      if (mounted.current) {
        await refresh()
        if (mounted.current) setOperation(null)
      }
      busy.current = false
    }
  }

  const stop = async () => {
    if (!snapshot || !last || !running || busy.current) return
    busy.current = true
    setOperation("stop")
    setProblem(null)
    try {
      await sideChatClient.stop(sourceId, snapshot.id, last.id)
    } catch {
      if (mounted.current) setProblem("stop")
    } finally {
      if (mounted.current) {
        await refresh()
        if (mounted.current) setOperation(null)
      }
      busy.current = false
    }
  }

  const quoteToMain = (answer: string, button: HTMLButtonElement) => {
    const selection = document.getSelection()
    const body = button.parentElement?.querySelector("[data-side-chat-answer]")
    const selected = selection && body?.contains(selection.anchorNode) && body.contains(selection.focusNode)
      ? selection.toString().trim() : ""
    onQuoteToMain(selected || answer)
    setQuoted(true)
  }

  return (
    <section aria-label={uiText("side_chat_title")} className="flex min-h-0 min-w-0 flex-1 flex-col" data-side-chat>
      <div ref={transcript} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" onScroll={(event) => {
        const node = event.currentTarget
        tail.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
      }}>
        {snapshot === undefined && !readFailed ? <p role="status" className="text-sm text-muted-foreground">{uiText("side_chat_loading")}</p> : null}
        {snapshot === null && !readFailed ? <p className="text-sm text-muted-foreground">{uiText("side_chat_empty")}</p> : null}
        {readFailed ? <div role="alert" className="text-sm text-destructive">
          {uiText("side_chat_read_failed")}
          <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()}>{uiText("retry_b8784c8d")}</Button>
        </div> : null}
        {snapshot?.turns.map((turn) => (
          <article key={turn.id} className="space-y-2">
            <div className="user-message-surface ml-auto w-fit max-w-[90%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              {turn.quote ? <button type="button" onClick={() => onRevealSource(turn.quote!.message_id)}
                className="mb-2 flex max-w-full items-center gap-1.5 text-left text-xs hover:underline"
                title={turn.quote.text} aria-label={uiText("side_chat_reveal_source")}>
                <span className="line-clamp-2">{turn.quote.text}</span><ArrowUpRight className="size-3.5 shrink-0" />
              </button> : null}
              {turn.message}
            </div>
            {turn.answer ? <div className="min-w-0 space-y-1 text-sm">
              <div data-side-chat-answer><AssistantMarkdown>{turn.answer}</AssistantMarkdown></div>
              <Button type="button" size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => quoteToMain(turn.answer, event.currentTarget)}>
                <MessageSquarePlus className="size-3.5" />{uiText("side_chat_quote_to_main")}
              </Button>
            </div> : null}
            {turn.status === "running" ? (
              <div className="min-w-0 text-sm">
                {previewText ? <AssistantMarkdown isStreaming>{previewText}</AssistantMarkdown>
                  : <p role="status" className="text-muted-foreground">{uiText("side_chat_answering")}</p>}
              </div>
            ) : turn.status !== "completed" ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {uiText(turn.status === "stopped" ? "side_chat_stopped" : "side_chat_answer_failed")}
                {turn.id === last?.id ? <Button type="button" size="sm" variant="ghost" disabled={!!operation || readFailed}
                  onClick={() => void submit(undefined, true)}>
                  <RotateCcw className="size-3.5" />{uiText("retry_b8784c8d")}
                </Button> : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <form className="shrink-0 space-y-2 border-t px-3 py-3" onSubmit={(event) => void submit(event)}>
        {draft.quote ? (
          <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-muted-foreground">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
              onClick={() => onRevealSource(draft.quote!.message_id)} aria-label={uiText("side_chat_reveal_source")} title={draft.quote.text}>
              <span className="truncate">{draft.quote.text}</span><ArrowUpRight className="size-3.5 shrink-0" />
            </button>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={uiText("side_chat_remove_quote")}
              onClick={() => changeDraft({ text: draft.text, chatId: draft.chatId })}><X className="size-3.5" /></Button>
          </div>
        ) : null}
        <Textarea ref={editor} rows={2} className="min-h-16 resize-none" value={draft.text}
          aria-label={uiText("side_chat_question")} placeholder={uiText("side_chat_question")}
          onChange={(event) => { setQuoted(false); changeDraft({ text: event.target.value, quote: draft.quote, chatId: snapshot?.id ?? draft.chatId }) }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }} />
        {problem || !sideChatQuestionFits(draft.text.trim()) ? <p role="alert" className="text-xs text-destructive">
          {uiText(problem === "stop" ? "side_chat_stop_failed" : problem === "send" ? "side_chat_send_failed" : "side_chat_question_too_long")}
        </p> : null}
        <div className="flex min-h-8 items-center justify-end gap-2">
          {quoted ? <span role="status" className="mr-auto text-xs text-muted-foreground">{uiText("side_chat_added_to_draft")}</span> : null}
          {running ? <Button type="button" size="sm" variant="secondary" disabled={!!operation} onClick={() => void stop()}>
            <Square className="size-3.5" />{uiText("side_chat_stop")}
          </Button> : <Button type="submit" size="sm" disabled={!!operation || readFailed || snapshot === undefined
            || !draft.text.trim() || !sideChatQuestionFits(draft.text.trim())}>{uiText("side_chat_send")}</Button>}
        </div>
      </form>
    </section>
  )
}
