import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ShieldAlert } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"
import { parseSessionPermissionMode, sessionPermissionRevision } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useNewSessionPermission } from "@shared/store/newSessionPermission"
import { composerControlClassName } from "./composerStyles"

type Props = { sessionId: string; title: string; compact?: boolean }

const compactPermissionSelectClassName = cn(composerControlClassName,
  "border-0 bg-transparent shadow-none dark:bg-transparent dark:hover:bg-accent [&>svg:last-child]:size-3")

function PermissionModeOptions() {
  return (
    <SelectContent side="top" align="start">
      <SelectItem value="default">Default</SelectItem>
      <SelectItem value="bypass">Bypass</SelectItem>
      <SelectItem value="auto">Auto</SelectItem>
    </SelectContent>
  )
}

/** A navigation change discards any unaccepted, session-scoped Auto confirmation. */
export function PermissionModeControl(props: Props) {
  return <SessionPermissionControl key={props.sessionId} {...props} />
}

function SessionPermissionControl({ sessionId, title, compact = false }: Props) {
  const { t } = useTranslation()
  const labelId = useId()
  const hasChat = useAppStore((state) => state.chats.some((chat) => chat.id === sessionId))
  const mode = useAppStore((state) => state.chats.find((chat) => chat.id === sessionId)?.config.permissionMode)
  const etag = useAppStore((state) => state.chats.find((chat) => chat.id === sessionId)?.config.permissionModeEtag)
  const request = useAppStore((state) => state.permissionModeRequests[sessionId])
  const refresh = useAppStore((state) => state.refreshSessionPermissionMode)
  const change = useAppStore((state) => state.changeSessionPermissionMode)
  const needsRead = !request
  const [confirmation, setConfirmation] = useState<{ etag: string } | null>(null)
  const selectRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (hasChat && needsRead) void refresh(sessionId)
  }, [sessionId, refresh, needsRead, hasChat])

  const validSnapshot = Boolean(parseSessionPermissionMode(mode) && sessionPermissionRevision(etag) !== null)
  const ready = request?.status === "ready" && validSnapshot
  const saving = request?.status === "saving"
  const confirmed = validSnapshot && (ready || saving)
  const busy = (hasChat && !request) || request?.status === "loading" || saving
  const unavailableLabel = !hasChat ? t("chat.permissionMode.unconfirmed") : request?.status === "unsupported"
    ? t("chat.permissionMode.unavailable")
    : busy ? t("chat.permissionMode.loading") : t("chat.permissionMode.unconfirmed")
  const helpText = confirmed ? t(`chat.permissionMode.help.${mode!}`) : t("chat.permissionMode.readRequired")
  const errorText = request?.error ? t(`chat.permissionMode.errors.${request.error}`) : null

  return (
    <section
      className={cn(compact ? "flex min-w-0 max-w-full flex-wrap items-center gap-1" : "shrink-0 border-b px-3 py-2")}
      aria-label={t("chat.permissionMode.section")}
      data-variant={compact ? "composer" : "bar"}
      title={compact ? [helpText, errorText].filter(Boolean).join(" ") : undefined}
    >
      <div className={cn("flex flex-wrap items-center", compact ? "gap-1" : "gap-x-3 gap-y-1.5")}>
        <label htmlFor={labelId} className={compact ? "sr-only" : "text-xs font-medium"}>{t("chat.permissionMode.label")}</label>
        <Select
          disabled={!ready}
          value={confirmed ? mode! : ""}
          onValueChange={(value) => {
            const nextMode = parseSessionPermissionMode(value)
            if (!ready || !etag || !nextMode || nextMode === mode) return
            if (nextMode === "auto") setConfirmation({ etag })
            else void change(sessionId, nextMode, etag)
          }}
        >
          <SelectTrigger
            ref={selectRef}
            id={labelId}
            aria-label={t("chat.permissionMode.label")}
            aria-describedby={`${labelId}-help${request?.error ? ` ${labelId}-error` : ""}`}
            size={compact ? "sm" : "default"}
            className={cn(
              compact ? compactPermissionSelectClassName : "max-w-full bg-background",
              "disabled:opacity-70",
              confirmed && mode === "auto" && (compact ? "text-amber-700 dark:text-amber-400" : "border-amber-500 text-amber-700 dark:text-amber-400"),
            )}
          >
            {compact ? <ShieldAlert className={cn("size-4 shrink-0", confirmed && mode === "auto" ? "text-amber-500" : "text-muted-foreground")} aria-hidden /> : null}
            <SelectValue placeholder={unavailableLabel} />
          </SelectTrigger>
          <PermissionModeOptions />
        </Select>
        <span role="status" className={compact ? "sr-only" : "text-xs text-muted-foreground"}>
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
        <p id={`${labelId}-error`} role="alert" className={compact ? "basis-full max-w-sm break-words text-xs leading-relaxed text-destructive" : "mt-1 text-xs leading-relaxed text-destructive"}>
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
    <div
      className="flex min-w-0 items-center"
      data-permission-scope="new-session"
      title={t(`chat.permissionMode.help.${mode}`)}
    >
      <span className="sr-only">{t("chat.permissionMode.label")}</span>
      <Select
        value={mode}
        onValueChange={(value) => {
          const nextMode = parseSessionPermissionMode(value)
          if (nextMode) setMode(nextMode)
        }}
      >
        <SelectTrigger
          aria-label={t("chat.permissionMode.label")}
          size="sm"
          className={cn(
            compactPermissionSelectClassName,
            mode === "auto" && "text-amber-700 dark:text-amber-400",
          )}
        >
          <ShieldAlert className={cn("size-4 shrink-0", mode === "auto" ? "text-amber-500" : "text-muted-foreground")} aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <PermissionModeOptions />
      </Select>
    </div>
  )
}
