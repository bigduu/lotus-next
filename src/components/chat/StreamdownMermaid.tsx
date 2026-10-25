import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useId, useRef, useState } from "react"
import { createMermaidPlugin } from "@streamdown/mermaid"
import { useThemeStore } from "@shared/store/themeStore"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { getTrustedMermaidConfig, MERMAID_STRICT_CONFIG, type MermaidTheme } from "@/lib/mermaid/strictConfig"

const mermaidPlugin = createMermaidPlugin({ config: MERMAID_STRICT_CONFIG })

type MermaidState =
  | { kind: "loading" }
  | { kind: "ready"; source: string; theme: MermaidTheme; svg: string }
  | { kind: "error"; source: string; theme: MermaidTheme; message: string }

let sequence = 0

/** A changed message discards only that diagram's local preview edits. */
export default function StreamdownMermaid({ code }: { code: string }) {
  return <MermaidPreview key={code} original={code} />
}

function MermaidPreview({ original }: { original: string }) {
  useUiLocale()
  const theme = useThemeStore((state) => state.themeMode)
  const editorId = useId()
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const [source, setSource] = useState(original)
  const [draft, setDraft] = useState(original)
  const [editing, setEditing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<MermaidState>({ kind: "loading" })
  const closeEditor = () => { setEditing(false); editButtonRef.current?.focus() }

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })

    // Restore the trusted app policy after exports; source never owns config.
    const mermaid = mermaidPlugin.getMermaid(getTrustedMermaidConfig("app", theme))
    const id = `streamdown-mermaid-${sequence++}`
    void mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (!cancelled) setState({ kind: "ready", source, theme, svg })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
            source,
            theme,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [source, theme, attempt])

  const current = state.kind !== "loading" && state.source === source && state.theme === theme
  const status = current ? state.kind : "loading"
  return (
    <figure className="my-4 min-w-0 rounded-xl border bg-card" data-mermaid-state={status}>
      <figcaption className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-medium">{uiText("mermaid_diagram_2a0d4106")}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button ref={editButtonRef} type="button" size="sm" variant="ghost" aria-expanded={editing}
            onClick={() => { setDraft(source); setEditing(!editing) }}>
            {uiText("mermaid_edit_source")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={status === "loading"}
            onClick={() => setAttempt((value) => value + 1)}>{uiText("mermaid_render_again")}</Button>
          {source !== original && <Button type="button" size="sm" variant="ghost" onClick={() => {
            setSource(original); setDraft(original); closeEditor(); setAttempt((value) => value + 1)
          }}>{uiText("mermaid_restore_original")}</Button>}
        </div>
      </figcaption>
      {editing && (
        <form className="space-y-2 border-t p-3" onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          setSource(draft); closeEditor(); setAttempt((value) => value + 1)
        }}>
          <label htmlFor={editorId} className="block text-sm font-medium">{uiText("mermaid_source")}</label>
          <Textarea id={editorId} aria-describedby={`${editorId}-hint`} value={draft} rows={8}
            className="min-h-40 max-h-80 border bg-background font-mono text-sm"
            autoFocus dir="ltr" spellCheck={false} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault(); event.stopPropagation(); closeEditor()
              }
            }} />
          <p id={`${editorId}-hint`} className="text-xs text-muted-foreground">{uiText("mermaid_local_preview_hint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!draft.trim()}>{uiText("mermaid_render_preview")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeEditor}>{uiText("mermaid_cancel_edit")}</Button>
          </div>
        </form>
      )}
      {status === "loading" ? (
        <div aria-label={uiText("rendering_mermaid_diagram_beb228f6")} className="min-h-24 animate-pulse rounded-xl bg-sidebar" role="status" />
      ) : current && state.kind === "error" ? (
        <div className="space-y-2 border-t p-3">
          <p role="alert" className="text-sm font-medium text-destructive">{uiText("could_not_render_mermaid_diagram_c26105d4")}</p>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{uiText("mermaid_error_details")}</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{state.message}</pre>
          </details>
          {!editing && <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]" data-mermaid-source>{source}</pre>}
        </div>
      ) : current && state.kind === "ready" ? (
        <div aria-label={uiText("mermaid_diagram_2a0d4106")} role="img"
          className="flex min-w-0 justify-center overflow-x-auto rounded-xl bg-background p-2 [&_svg]:h-auto [&_svg]:max-w-full"
          // SVG comes only from Mermaid under the shared strict/native-label policy.
          dangerouslySetInnerHTML={{ __html: state.svg }} />
      ) : null}
    </figure>
  )
}
