import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ShieldAlert } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"
import { parseSessionPermissionMode, sessionPermissionRevision } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Props = { sessionId: string; title: string }

/** A navigation change discards any unaccepted, session-scoped Auto confirmation. */
export function PermissionModeControl(props: Props) {
  return <SessionPermissionControl key={props.sessionId} {...props} />
}

function SessionPermissionControl({ sessionId, title }: Props) {
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

  return (
    <section className="shrink-0 border-b px-3 py-2" aria-label={t("chat.permissionMode.section")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor={labelId} className="text-xs font-medium">{t("chat.permissionMode.label")}</label>
        <select
          ref={selectRef}
          id={labelId}
          aria-label={t("chat.permissionMode.label")}
          aria-describedby={`${labelId}-help${request?.error ? ` ${labelId}-error` : ""}`}
          disabled={!ready}
          value={confirmed ? mode! : ""}
          className={cn("h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70", confirmed && mode === "auto" && "border-amber-500 text-amber-700 dark:text-amber-400")}
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
        <span role="status" className="text-xs text-muted-foreground">
          {saving ? t("chat.permissionMode.saving") : busy ? t("chat.permissionMode.loading") : null}
        </span>
        {request?.error ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh(sessionId)}>
            {t("chat.permissionMode.refresh")}
          </Button>
        ) : null}
      </div>
      <p id={`${labelId}-help`} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {confirmed ? t(`chat.permissionMode.help.${mode!}`) : t("chat.permissionMode.readRequired")}
      </p>
      {request?.error ? (
        <p id={`${labelId}-error`} role="alert" className="mt-1 text-xs leading-relaxed text-destructive">
          {t(`chat.permissionMode.errors.${request.error}`)}
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
