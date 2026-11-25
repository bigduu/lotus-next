import { createEffect, createSignal, createUniqueId, Match, Show, Switch, untrack } from "solid-js"
import type { MermaidTheme } from "../../lib/mermaid/strictConfig"
import { importWithLocalPreloadRecovery } from "../../runtime/preloadErrorPolicy"
import type { MarkdownText } from "./text"

type MermaidRender = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error"; message: string }
type RenderMermaid = typeof import("./renderMermaid").renderMermaid

let rendererLoad: Promise<RenderMermaid | undefined> | undefined
const MERMAID_RELOAD_KEY = "lotus_mermaid_preload_reload_attempted"

function reloadMermaidPageOnce() {
  try {
    if (sessionStorage.getItem(MERMAID_RELOAD_KEY)) return
    sessionStorage.setItem(MERMAID_RELOAD_KEY, "1")
  } catch {
    // A persistent flag is required to retry safely across navigation.
    return
  }
  window.location.reload()
}

function loadMermaidRenderer() {
  // Browsers retain a failed module import for the lifetime of the document.
  // Share one alternate entry across all diagram cards.
  return rendererLoad ??= importWithLocalPreloadRecovery(() => import("./renderMermaid"))
    .catch(() => importWithLocalPreloadRecovery(() => import("./recoverMermaidRenderer")))
    .then((module) => {
      if (!module) return undefined
      try { sessionStorage.removeItem(MERMAID_RELOAD_KEY) } catch { /* storage is optional */ }
      return module.renderMermaid
    }, (error: unknown) => {
      reloadMermaidPageOnce()
      throw error
    })
}

const BUTTON_CLASS = "inline-flex h-8 items-center justify-center gap-1 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground"

export function MermaidBlock(props: { original: string; theme: MermaidTheme; text: MarkdownText }) {
  const original = untrack(() => props.original)
  const [source, setSource] = createSignal(original)
  const [draft, setDraft] = createSignal(original)
  const [editing, setEditing] = createSignal(false)
  const [attempt, setAttempt] = createSignal(0)
  const [state, setState] = createSignal<MermaidRender>({ kind: "loading" })
  const message = () => {
    const value = state()
    return value.kind === "error" ? value.message : undefined
  }
  const image = () => {
    const value = state()
    return value.kind === "ready" ? value.url : undefined
  }
  const editorId = createUniqueId()
  let editButton!: HTMLButtonElement
  let editor: HTMLTextAreaElement | undefined

  const retry = () => setAttempt((value) => value + 1)
  const closeEditor = () => {
    setEditing(false)
    editButton.focus()
  }

  createEffect(editing, (open) => { if (open) editor?.focus() })
  createEffect(
    () => ({ source: source(), theme: props.theme, attempt: attempt() }),
    ({ source, theme }) => {
      const controller = new AbortController()
      let imageUrl: string | undefined
      setState({ kind: "loading" })
      void loadMermaidRenderer().then((render) => {
        // Vite can resolve without exports when its preload handler is reloading the page.
        if (!render || controller.signal.aborted) return
        return render(source, theme, controller.signal)
      }).then(
        (svg) => {
          if (svg === undefined || controller.signal.aborted) return
          // Render the strict SVG as an image document to isolate its styles
          // and keep Mermaid content out of the application's DOM.
          imageUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
          setState({ kind: "ready", url: imageUrl })
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setState({ kind: "error", message: error instanceof Error ? error.message : String(error) })
          }
        },
      )
      return () => {
        controller.abort()
        if (imageUrl) URL.revokeObjectURL(imageUrl)
      }
    },
  )

  return (
    <figure class="my-4 min-w-0 rounded-xl border bg-card" data-mermaid-state={state().kind}>
      <figcaption class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span class="font-medium">{props.text("mermaid_diagram_2a0d4106")}</span>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <button ref={(element) => { editButton = element }} type="button" class={BUTTON_CLASS} aria-expanded={editing() ? "true" : "false"}
            onClick={() => {
              if (editing()) closeEditor()
              else { setDraft(source()); setEditing(true) }
            }}>{props.text("mermaid_edit_source")}</button>
          <button type="button" class={BUTTON_CLASS} disabled={state().kind === "loading"} onClick={retry}>
            {props.text("mermaid_render_again")}
          </button>
          <Show when={source() !== original}>
            <button type="button" class={BUTTON_CLASS} onClick={() => {
              setSource(original)
              setDraft(original)
              closeEditor()
              retry()
            }}>{props.text("mermaid_restore_original")}</button>
          </Show>
        </div>
      </figcaption>
      <Show when={editing()}>
        <form class="space-y-2 border-t p-3" onSubmit={(event) => {
          event.preventDefault()
          const next = draft()
          if (!next.trim()) return
          setSource(next)
          closeEditor()
          retry()
        }}>
          <label for={editorId} class="block text-sm font-medium">{props.text("mermaid_source")}</label>
          <textarea
            ref={(element) => { editor = element }}
            id={editorId}
            aria-describedby={`${editorId}-hint`}
            value={draft()}
            rows={8}
            class="block min-h-40 max-h-80 w-full rounded-md border bg-background p-3 font-mono text-sm"
            dir="ltr"
            spellcheck={false}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return
              event.preventDefault()
              event.stopPropagation()
              closeEditor()
            }}
          />
          <p id={`${editorId}-hint`} class="text-xs text-muted-foreground">{props.text("mermaid_local_preview_hint")}</p>
          <div class="flex flex-wrap items-center gap-2">
            <button type="submit" class={`${BUTTON_CLASS} bg-primary text-primary-foreground`}
              disabled={!draft().trim()}>{props.text("mermaid_render_preview")}</button>
            <button type="button" class={BUTTON_CLASS} onClick={closeEditor}>{props.text("mermaid_cancel_edit")}</button>
          </div>
        </form>
      </Show>
      <Switch>
        <Match when={state().kind === "loading"}>
          <div aria-label={props.text("rendering_mermaid_diagram_beb228f6")}
            class="min-h-24 animate-pulse rounded-xl bg-sidebar" role="status" />
        </Match>
        <Match when={state().kind === "error"}>
          <div class="space-y-2 border-t p-3">
            <p role="alert" class="text-sm font-medium text-destructive">
              {props.text("could_not_render_mermaid_diagram_c26105d4")}
            </p>
            <details class="text-xs">
              <summary class="cursor-pointer text-muted-foreground">{props.text("mermaid_error_details")}</summary>
              <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">
                {message()}
              </pre>
            </details>
            <Show when={!editing()}>
              <pre class="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]"
                data-mermaid-source>{source()}</pre>
            </Show>
          </div>
        </Match>
        <Match when={state().kind === "ready"}>
          <div class="flex min-w-0 justify-center overflow-x-auto rounded-xl bg-background p-2">
            <img
              src={image()}
              alt={props.text("mermaid_diagram_2a0d4106")}
              class="m-0 h-auto max-w-full"
            />
          </div>
        </Match>
      </Switch>
    </figure>
  )
}
