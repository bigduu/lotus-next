import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type {
  ContextManagementStrategy,
  SectionMessage,
  SystemBambooConfig,
  SystemConfigApi,
} from "./useSystemConfig"

const configuredStrategy = (config: SystemBambooConfig): ContextManagementStrategy =>
  config.context_management?.strategy === "retrieval_window" ? "retrieval_window" : "summary"

/** 上下文管理 — 在滚动摘要与精确历史检索窗口之间切换。 */
export function SectionContextManagement({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  // Seed once at mount. Other sections share and refresh the same config;
  // re-seeding here would overwrite an unsaved local choice.
  const initialStrategy = configuredStrategy(config)
  const [summariesEnabled, setSummariesEnabled] = useState(initialStrategy === "summary")
  const [savedStrategy, setSavedStrategy] = useState<ContextManagementStrategy>(initialStrategy)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const selectedStrategy: ContextManagementStrategy = summariesEnabled
    ? "summary"
    : "retrieval_window"
  const dirty = selectedStrategy !== savedStrategy

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const patch: SystemBambooConfig = summariesEnabled
        ? { context_management: { strategy: "summary" } }
        : {
            context_management: {
              strategy: "retrieval_window",
              retrieval_window: {
                // "Off" must really mean no model-generated summary fallback.
                history_tool_required: true,
                fallback_strategy: "none",
              },
            },
          }
      const saved = await saveSection(patch)
      const persistedStrategy = configuredStrategy(saved)
      setSummariesEnabled(persistedStrategy === "summary")
      setSavedStrategy(persistedStrategy)
      setMsg({ kind: "ok", text: "已保存" })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">上下文管理</div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm">自动生成上下文摘要</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {summariesEnabled
              ? "达到上下文压力阈值时，用后台模型生成滚动摘要。"
              : "已关闭：改用检索窗口；原始消息仍保存在会话历史中，模型按需检索。"}
          </p>
        </div>
        <Switch
          checked={summariesEnabled}
          disabled={busy}
          onCheckedChange={(checked) => {
            setSummariesEnabled(checked)
            setMsg(null)
          }}
          aria-label="自动生成上下文摘要"
        />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        保存后无需重启，从下一次执行开始生效；正在运行的任务会继续使用启动时的策略。
      </p>

      {!summariesEnabled ? (
        <p className="rounded-md bg-muted px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          已有摘要的会话不会自动转换。保存后请新建会话使用检索窗口；已有原始历史不会被删除。
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <StatusLine msg={msg} />
        <Button size="sm" className="ml-auto" onClick={save} disabled={busy || !dirty}>
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  )
}
