import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Terminal, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RuntimeNoticeInfo } from "./runtimeNotices"

export function RuntimeNoticeCard({ notice }: { notice: RuntimeNoticeInfo }) {
  useUiLocale()
  return (
    <div
      data-runtime-notice={notice.runtimeKind}
      className="border border-border/60 bg-muted/30 text-muted-foreground flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm"
    >
      <Terminal className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">
          {uiText("runtime_notice_background_exec_title_1b8a7ef0")}
        </div>
        <div className="mt-0.5">
          {uiText("runtime_notice_background_exec_body_c90c9f52")}
        </div>
        {notice.execSessionId ? (
          <div className="mt-1 font-mono text-xs break-all opacity-70">
            {uiText("runtime_notice_background_exec_handle_0f9a6d34", { v0: notice.execSessionId })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Inline running hint shown while a background command wait is active. */
export function BackgroundExecWaitHint({ className }: { className?: string }) {
  useUiLocale()
  return (
    <div className={cn("text-muted-foreground flex items-center gap-2 text-sm", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {uiText("runtime_notice_background_exec_running_93d0e2c1")}
    </div>
  )
}
