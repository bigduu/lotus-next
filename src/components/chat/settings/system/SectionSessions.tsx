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
  all: "删除全部会话",
  empty: "删除空会话",
  children: "删除子会话",
}

/** 会话维护 — 清空当前会话 / 批量清理 / 开发重置(带确认). */
export function SectionSessions() {
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
          title: "清空当前会话消息?",
          description: "将删除当前会话的全部消息与事件记录,会话本身保留。此操作不可撤销。",
          label: "清空",
        }
      case "cleanup": {
        const scope =
          action.mode === "all" ? "全部会话" : action.mode === "empty" ? "所有空会话" : "所有子会话"
        return {
          title: `${CLEANUP_LABEL[action.mode]}?`,
          description: `将删除${scope}${keepPinned ? "(已置顶的会话会保留)" : "(包括已置顶的会话)"}。此操作不可撤销。`,
          label: "删除",
        }
      }
      case "dev-reset":
        return {
          title: "重置会话存储?",
          description: "开发用途:删除后端全部会话数据并重建索引。此操作不可撤销。",
          label: "重置",
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
        setMsg({ kind: "ok", text: "当前会话已清空" })
      } else if (pending.type === "cleanup") {
        await agentClient.cleanupSessions(pending.mode, keepPinned)
        await loadChats()
        setMsg({ kind: "ok", text: "清理完成" })
      } else {
        await agentClient.devResetSessions()
        await loadChats()
        setMsg({ kind: "ok", text: "会话存储已重置" })
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
      <div className="text-xs font-medium text-muted-foreground">会话维护</div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">当前会话</div>
        {current ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{current.title || current.id}</div>
              <div className="truncate text-xs text-muted-foreground">
                {current.kind === "child" ? "子会话" : "根会话"} · {current.id}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => open({ type: "clear-current", sessionId: current.id })}
            >
              清空消息
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂无活动会话</p>
        )}
      </div>

      <div className="space-y-2 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm">批量清理时保留已置顶</div>
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
          开发重置:删除后端全部会话数据并重建索引
        </div>
        <Button size="sm" variant="destructive" onClick={() => open({ type: "dev-reset" })}>
          重置会话存储
        </Button>
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
