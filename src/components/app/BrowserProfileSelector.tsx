import { useId, useState } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import type { BrowserProfileMode } from "@services/browser/types"
import type { BrowserProfileReport } from "@services/browser/profileMode"

/** User-intent port. The consumer owns transport outcomes and request fencing. */
export interface BrowserProfileActions {
  open: (sessionId: string, mode: BrowserProfileMode) => void
  close: (sessionId: string) => void
  /** Existing API default; never promises profile isolation or sharing. */
  openDefault?: (sessionId: string) => void
  /** User-explicit clean request; capability is confirmed only by the response. */
  openClean?: (sessionId: string) => void
}

export function BrowserProfileSelector({
  sessionId,
  profile,
  phase,
  pending = false,
  notice,
  actions,
}: {
  sessionId: string
  profile: BrowserProfileReport
  /** UI lifecycle, not a new server DTO field. A closed scope needs its last validated report. */
  phase: "active" | "closed"
  pending?: boolean
  notice?: "mode_conflict"
  actions?: BrowserProfileActions
}) {
  useUiLocale()
  const selectId = useId()
  const [draft, setDraft] = useState<{ sessionId: string; mode: BrowserProfileMode } | null>(null)
  const selected = draft?.sessionId === sessionId ? draft.mode : "shared"

  if (profile.kind !== "reported") {
    return <section className="flex flex-col gap-3 text-sm" aria-label={uiText("browser_profile_label")} aria-busy={pending}>
      {phase === "closed" ? <p role="status">{uiText("browser_profile_closed")}</p> : null}
      <p role="status" className="text-muted-foreground">
        {profile.kind === "invalid" ? uiText("browser_profile_invalid") : uiText("browser_profile_unreported")}
      </p>
      {profile.kind === "unreported" && phase === "closed" && actions?.openDefault ? <>
        <p className="text-xs text-muted-foreground">{uiText("browser_profile_default_help")}</p>
        <Button type="button" variant="outline" disabled={pending} onClick={() => {
          if (!pending) actions.openDefault?.(sessionId)
        }}>{uiText("browser_profile_open_default")}</Button>
        {actions.openClean ? <Button type="button" variant="outline" disabled={pending} onClick={() => {
          if (!pending) actions.openClean?.(sessionId)
        }}>{uiText("browser_profile_open_clean")}</Button> : null}
      </> : null}
    </section>
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 text-sm" aria-label={uiText("browser_profile_label")} aria-busy={pending}>
      <p role="status">
        {phase === "closed" ? uiText("browser_profile_closed") : uiText("browser_profile_current", {
          mode: profile.kind === "reported" && profile.mode === "shared" ? uiText("browser_profile_shared") : uiText("browser_profile_clean"),
        })}
      </p>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{uiText("browser_profile_shared_help")}</p>
        <p>{uiText("browser_profile_clean_help")}</p>
      </div>
      {notice === "mode_conflict" ? <p role="alert">{uiText("browser_profile_conflict")}</p> : null}
      {actions ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => {
          event.preventDefault()
          if (pending || phase !== "closed") return
          actions.open(sessionId, selected)
        }}>
          <label htmlFor={selectId}>{uiText("browser_profile_next_mode")}</label>
          <select id={selectId} className="h-9 min-w-0 rounded-md border bg-background px-2" value={selected} disabled={pending}
            onChange={(event) => {
              const mode = event.target.value
              if (mode === "shared" || mode === "clean") setDraft({ sessionId, mode })
            }}>
            <option value="shared">{uiText("browser_profile_shared")}</option>
            <option value="clean">{uiText("browser_profile_clean")}</option>
          </select>
          {phase === "active" ? (
            <>
              <p className="text-xs text-muted-foreground">{uiText("browser_profile_switch_help")}</p>
              <p className="text-xs text-muted-foreground">{uiText("browser_profile_close_help")}</p>
              <Button type="button" variant="outline" disabled={pending} onClick={() => {
                if (!pending) actions.close(sessionId)
              }}>{uiText("browser_profile_close")}</Button>
            </>
          ) : <Button type="submit" disabled={pending}>{uiText("browser_profile_open")}</Button>}
        </form>
      ) : null}
    </section>
  )
}
