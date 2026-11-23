import { createSignal, createUniqueId, Show } from "solid-js"
import type { BrowserProfileMode } from "@services/browser/types"
import type { BrowserProfileReport } from "@services/browser/profileMode"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"

export interface BrowserProfileActions {
  open: (sessionId: string, mode: BrowserProfileMode) => void
  close: (sessionId: string) => void
  openDefault?: (sessionId: string) => void
  openClean?: (sessionId: string) => void
}

export function createBrowserProfileDraft() {
  const [choice, setChoice] = createSignal<{ sessionId: string; mode: BrowserProfileMode } | null>(null)
  return {
    mode: (sessionId: string): BrowserProfileMode => {
      const current = choice()
      return current?.sessionId === sessionId ? current.mode : "shared"
    },
    select: (sessionId: string, mode: BrowserProfileMode) => setChoice({ sessionId, mode }),
  }
}

interface BrowserProfileSelectorProps {
  sessionId: string
  profile: BrowserProfileReport
  phase: "active" | "closed"
  nextMode: BrowserProfileMode
  onNextModeChange: (mode: BrowserProfileMode) => void
  pending?: boolean
  notice?: "mode_conflict"
  actions?: BrowserProfileActions
}

export function BrowserProfileSelector(props: BrowserProfileSelectorProps) {
  const text = createUiText()
  const selectId = createUniqueId()

  return (
    <Show when={props.profile.kind === "reported"} fallback={
      <section class="flex flex-col gap-3 text-sm" aria-label={text("browser_profile_label")} aria-busy={props.pending ? "true" : "false"}>
        <Show when={props.phase === "closed"}><p role="status">{text("browser_profile_closed")}</p></Show>
        <p role="status" class="text-muted-foreground">
          {text(props.profile.kind === "invalid" ? "browser_profile_invalid" : "browser_profile_unreported")}
        </p>
        <Show when={props.profile.kind === "unreported" && props.phase === "closed" && props.actions?.openDefault}>
          <p class="text-xs text-muted-foreground">{text("browser_profile_default_help")}</p>
          <Button type="button" variant="outline" disabled={props.pending} onClick={() => {
            if (!props.pending) props.actions?.openDefault?.(props.sessionId)
          }}>{text("browser_profile_open_default")}</Button>
          <Show when={props.actions?.openClean}>
            <Button type="button" variant="outline" disabled={props.pending} onClick={() => {
              if (!props.pending) props.actions?.openClean?.(props.sessionId)
            }}>{text("browser_profile_open_clean")}</Button>
          </Show>
        </Show>
      </section>
    }>
      <section class="flex min-w-0 flex-col gap-3 text-sm" aria-label={text("browser_profile_label")} aria-busy={props.pending ? "true" : "false"}>
        <p role="status">
          {props.phase === "closed" ? text("browser_profile_closed") : text("browser_profile_current", {
            mode: text(props.profile.kind === "reported" && props.profile.mode === "shared"
              ? "browser_profile_shared" : "browser_profile_clean"),
          })}
        </p>
        <div class="space-y-1 text-xs text-muted-foreground">
          <p>{text("browser_profile_shared_help")}</p>
          <p>{text("browser_profile_clean_help")}</p>
        </div>
        <Show when={props.notice === "mode_conflict"}><p role="alert">{text("browser_profile_conflict")}</p></Show>
        <Show when={props.actions}>
          <form class="flex flex-col gap-2" onSubmit={(event) => {
            event.preventDefault()
            if (props.pending || props.phase !== "closed") return
            props.actions?.open(props.sessionId, props.nextMode)
          }}>
            <label for={selectId}>{text("browser_profile_next_mode")}</label>
            <select id={selectId} class="h-9 min-w-0 rounded-md border bg-background px-2" value={props.nextMode} disabled={props.pending}
              onChange={(event) => {
                const mode = event.currentTarget.value
                if (mode === "shared" || mode === "clean") props.onNextModeChange(mode)
              }}>
              <option value="shared">{text("browser_profile_shared")}</option>
              <option value="clean">{text("browser_profile_clean")}</option>
            </select>
            <Show when={props.phase === "active"} fallback={<Button type="submit" disabled={props.pending}>{text("browser_profile_open")}</Button>}>
              <p class="text-xs text-muted-foreground">{text("browser_profile_switch_help")}</p>
              <p class="text-xs text-muted-foreground">{text("browser_profile_close_help")}</p>
              <Button type="button" variant="outline" disabled={props.pending} onClick={() => {
                if (!props.pending) props.actions?.close(props.sessionId)
              }}>{text("browser_profile_close")}</Button>
            </Show>
          </form>
        </Show>
      </section>
    </Show>
  )
}
