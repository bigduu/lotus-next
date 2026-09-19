import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, ShieldAlert } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"
import { parseSessionPermissionMode, sessionPermissionRevision } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useNewSessionPermission } from "@shared/store/newSessionPermission"

type Props = { sessionId: string; title: string; compact?: boolean }

const compactPermissionSelectClassName =
  "h-8 w-[4.5rem] appearance-none rounded-md border-0 bg-transparent py-0 pl-1 pr-4 text-center text-xs font-medium [text-align-last:center] outline-none focus-visible:ring-2 focus-visible:ring-ring"

function CompactPermissionChevron() {
  return (
    <ChevronDown
      data-permission-chevron
      aria-hidden
      className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
    />
  )
}

/** A navigation change discards any unaccepted, session-scoped Auto confirmation. */
export function PermissionModeControl(props: Props) {
  return <SessionPermissionControl key={props.sessionId} {...props} />
}

function SessionPermissionControl({ sessionId, title, compact = false }: Props) {
  const { t } = useTranslation()
  const labelId = useId()
  const mode = useAppStore((state) => state.chats.find((chat) => chat.id === sessionId)?.config.permissionMode)
  const etag = useAppStore((state) => state.chats.find((chat) => chat.id === sessionId)?.config.permissionModeEtag)
  const request = useAppStore((state) => state.permissionModeRequests[sessionId])
  const refresh = useAppStore((state) => state.refreshSessionPermissionMode)
  const change = useAppStore((state) => state.changeSessionPermissionMode)
  const needsRead = !request
  const [confirmation, setConfirmation] = useState<{ etag: string } | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (needsRead) void refresh(sessionId)
  }, [sessionId, refresh, needsRead])

  const validSnapshot = Boolean(parseSessionPermissionMode(mode) && sessionPermissionRevision(etag) !== null)
  const ready = request?.status === "ready" && validSnapshot
  const saving = request?.status === "saving"
  const confirmed = validSnapshot && (ready || saving)
  const busy = !request || request.status === "loading" || saving
  const unavailableLabel = request?.status === "unsupported"
    ? t("chat.permissionMode.unavailable")
    : request?.status === "unconfirmed" ? t("chat.permissionMode.unconfirmed") : t("chat.permissionMode.loading")
  const helpText = confirmed ? t(`chat.permissionMode.help.${mode!}`) : t("chat.permissionMode.readRequired")
  const errorText = request?.error ? t(`chat.permissionMode.errors.${request.error}`) : null

  return (
    <section
      className={cn(compact ? "flex min-w-0 items-center gap-1" : "shrink-0 border-b px-3 py-2")}
      aria-label={t("chat.permissionMode.section")}
      data-variant={compact ? "composer" : "bar"}
      title={compact ? [helpText, errorText].filter(Boolean).join(" ") : undefined}
    >
      <div className={cn("flex flex-wrap items-center", compact ? "gap-1 rounded-md px-1 transition-colors hover:bg-accent" : "gap-x-3 gap-y-1.5")}>
        {compact ? <ShieldAlert className={cn("size-3.5 shrink-0", confirmed && mode === "auto" ? "text-amber-500" : "text-muted-foreground")} aria-hidden /> : null}
        <label htmlFor={labelId} className={compact ? "sr-only" : "text-xs font-medium"}>{t("chat.permissionMode.label")}</label>
        <div className={compact ? "relative shrink-0" : "contents"}>
          <select
            ref={selectRef}
            id={labelId}
            aria-label={t("chat.permissionMode.label")}
            aria-describedby={`${labelId}-help${request?.error ? ` ${labelId}-error` : ""}`}
            disabled={!ready}
            value={confirmed ? mode! : ""}
            className={cn(
              compact
                ? `${compactPermissionSelectClassName} disabled:cursor-not-allowed disabled:opacity-70`
                : "h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70",
              confirmed && mode === "auto" && (compact ? "text-amber-700 dark:text-amber-400" : "border-amber-500 text-amber-700 dark:text-amber-400"),
            )}
            onChange={(event) => {
              const nextMode = parseSessionPermissionMode(event.currentTarget.value)
              if (!ready || !etag || !nextMode || nextMode === mode) return
              if (nextMode === "auto") setConfirmation({ etag })
              else void change(sessionId, nextMode, etag)
            }}
          >
            <option value="" disabled>{unavailableLabel}</option>
            <option value="default">Default</option>
            <option value="bypass">Bypass</option>
            <option value="auto">Auto</option>
          </select>
          {compact ? <CompactPermissionChevron /> : null}
        </div>
        <span role="status" className="text-xs text-muted-foreground">
          {saving ? t("chat.permissionMode.saving") : busy ? t("chat.permissionMode.loading") : null}
        </span>
        {request?.error ? (
          <Button size="sm" variant="ghost" className={compact ? "h-7 px-1.5 text-xs" : undefined} disabled={busy} onClick={() => void refresh(sessionId)}>
            {t("chat.permissionMode.refresh")}
          </Button>
        ) : null}
      </div>
      <p id={`${labelId}-help`} className={compact ? "sr-only" : "mt-1.5 text-xs leading-relaxed text-muted-foreground"}>
        {helpText}
      </p>
      {request?.error ? (
        <p id={`${labelId}-error`} role="alert" className={compact ? "sr-only" : "mt-1 text-xs leading-relaxed text-destructive"}>
          {errorText}
        </p>
      ) : null}
      <Dialog open={Boolean(confirmation && confirmation.etag === etag)} onOpenChange={(open) => { if (!open) setConfirmation(null) }}>
        <DialogContent
          onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus() }}
          onCloseAutoFocus={(event) => { event.preventDefault(); selectRef.current?.focus() }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 shrink-0 text-amber-500" />
              {t("chat.permissionMode.confirmTitle")}
            </DialogTitle>
            <DialogDescription className="break-words">
              {t("chat.permissionMode.confirmDescription", { title })}
            </DialogDescription>
          </DialogHeader>
          {!ready ? <p role="alert" className="text-sm text-destructive">{t("chat.permissionMode.readRequired")}</p> : null}
          <DialogFooter>
            <Button ref={cancelRef} variant="outline" onClick={() => setConfirmation(null)}>{t("chat.permissionMode.cancel")}</Button>
            <Button variant="destructive" disabled={!ready} onClick={() => {
              const expected = confirmation?.etag
              if (!ready || !expected || expected !== etag) return
              setConfirmation(null)
              void change(sessionId, "auto", expected)
            }}>{t("chat.permissionMode.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** Permission mode stamped onto the next session created by this composer. */
export function NewSessionPermissionControl() {
  const { t } = useTranslation()
  const mode = useNewSessionPermission((state) => state.mode)
  const setMode = useNewSessionPermission((state) => state.setMode)
  const refresh = useNewSessionPermission((state) => state.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <label
      className="flex min-w-0 items-center gap-1 rounded-md px-1 transition-colors hover:bg-accent"
      data-permission-scope="new-session"
      title={t(`chat.permissionMode.help.${mode}`)}
    >
      <ShieldAlert className={cn("size-3.5 shrink-0", mode === "auto" ? "text-amber-500" : "text-muted-foreground")} aria-hidden />
      <span className="sr-only">{t("chat.permissionMode.label")}</span>
      <span className="relative shrink-0">
        <select
          aria-label={t("chat.permissionMode.label")}
          value={mode}
          onChange={(event) => {
            const nextMode = parseSessionPermissionMode(event.currentTarget.value)
            if (nextMode) setMode(nextMode)
          }}
          className={cn(
            compactPermissionSelectClassName,
            mode === "auto" && "text-amber-700 dark:text-amber-400",
          )}
        >
          <option value="default">Default</option>
          <option value="bypass">Bypass</option>
          <option value="auto">Auto</option>
        </select>
        <CompactPermissionChevron />
      </span>
    </label>
  )
}
