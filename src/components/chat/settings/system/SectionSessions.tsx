import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { agentClient } from "@services/chat/AgentService"
import { getErrorMessage } from "@services/api"
import { useAppStore } from "@shared/store/appStore"
import { ConfirmDialog } from "./ConfirmDialog"
import { StatusLine } from "./StatusLine"
import type { SectionMessage } from "./useSystemConfig"

type PendingAction =
  | { type: "clear-current"; sessionId: string }
  | { type: "cleanup"; mode: "all" | "empty" | "children" }
  | { type: "dev-reset" }

const CLEANUP_LABEL: Record<"all" | "empty" | "children", string> = {
  get all() { return uiText("delete_all_sessions_ddae77af") },
  get empty() { return uiText("delete_empty_sessions_1a185d3a") },
  get children() { return uiText("delete_child_sessions_a50c6edd") },
}

/** 会话维护 — 清空当前会话 / 批量清理 / 开发重置(带确认). */
export function SectionSessions() {
  useUiLocale()
  const chats = useAppStore((s) => s.chats)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const loadChats = useAppStore((s) => s.loadChats)
  const refreshChats = useAppStore((s) => s.refreshChats)
  const loadChatHistory = useAppStore((s) => s.loadChatHistory)

  const [keepPinned, setKeepPinned] = useState(true)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const current = useMemo(
    () => (currentSessionId ? (chats.find((c) => c.id === currentSessionId) ?? null) : null),
    [chats, currentSessionId]
  )

  const dialogText = (action: PendingAction): { title: string; description: string; label: string } => {
    switch (action.type) {
      case "clear-current":
        return {
          title: uiText("clear_current_session_messages_fd367d05"),
          description: uiText("delete_all_messages_and_events_from_the_current_session_1b83eb83"),
          label: uiText("clear_1ef3de06"),
        }
      case "cleanup": {
        const scope =
          action.mode === "all" ? uiText("all_sessions_19c6c208") : action.mode === "empty" ? uiText("all_empty_sessions_5ed386ae") : uiText("all_child_sessions_343eb995")
        return {
          title: `${CLEANUP_LABEL[action.mode]}?`,
          description: uiText("delete_this_cannot_be_undone_185d9a6f", { v0: scope, v1: keepPinned ? uiText("pinned_kept") : uiText("pinned_included") }),
          label: uiText("delete_2f9daa82"),
        }
      }
      case "dev-reset":
        return {
          title: uiText("reset_session_storage_40780a5f"),
          description: uiText("for_development_delete_all_backend_session_data_and_reb_86af26c4"),
          label: uiText("reset_cb5d682b"),
        }
    }
  }

  const execute = async () => {
    if (!pending) return
    setBusy(true)
    setActionError(null)
    try {
      if (pending.type === "clear-current") {
        await agentClient.clearSession(pending.sessionId)
        await loadChatHistory(pending.sessionId)
        await refreshChats()
        setMsg({ kind: "ok", text: uiText("current_session_cleared_cc0d93c0") })
      } else if (pending.type === "cleanup") {
        await agentClient.cleanupSessions(pending.mode, keepPinned)
        await loadChats()
        setMsg({ kind: "ok", text: uiText("cleanup_complete_6d256e25") })
      } else {
        await agentClient.devResetSessions()
        await loadChats()
        setMsg({ kind: "ok", text: uiText("session_storage_reset_30160c67") })
      }
      setPending(null)
    } catch (e) {
      setActionError(getErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const open = (action: PendingAction) => {
    setActionError(null)
    setMsg(null)
    setPending(action)
  }

  const text = pending ? dialogText(pending) : null

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{uiText("session_maintenance_6ce8056e")}</div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{uiText("current_session_9800a458")}</div>
        {current ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{current.title || current.id}</div>
              <div className="truncate text-xs text-muted-foreground">
                {current.kind === "child" ? uiText("child_7f54b15e") : uiText("root_session_label")} · {current.id}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => open({ type: "clear-current", sessionId: current.id })}
            >
              {uiText("clear_messages_d37fb6f4")}</Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{uiText("no_active_session_d3a91aa2")}</p>
        )}
      </div>

      <div className="space-y-2 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm">{uiText("keep_pinned_sessions_during_bulk_cleanup_66ca3998")}</div>
          <Switch checked={keepPinned} onCheckedChange={setKeepPinned} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "empty", "children"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant="destructive"
              onClick={() => open({ type: "cleanup", mode })}
            >
              {CLEANUP_LABEL[mode]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1 border-t pt-2">
        <div className="text-xs text-muted-foreground">
          {uiText("development_reset_delete_all_backend_session_data_and_r_0331fbb6")}</div>
        <Button size="sm" variant="destructive" onClick={() => open({ type: "dev-reset" })}>
          {uiText("reset_session_storage_226dd63a")}</Button>
      </div>

      <StatusLine msg={msg} />

      {pending && text ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setPending(null)
          }}
          title={text.title}
          description={text.description}
          confirmLabel={text.label}
          busy={busy}
          error={actionError}
          onConfirm={() => void execute()}
        />
      ) : null}
    </section>
  )
}
