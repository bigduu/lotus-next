import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ShieldAlert } from "lucide-react"

/** Header pill shown while a session has permission-approval bypassed. */
export function BypassToggle({ onClick }: { onClick: () => void }) {
  useUiLocale()
  return (
    <button
      onClick={onClick}
      title={uiText("approval_bypass_enabled_click_to_disable_158a67d7")}
      className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400"
    >
      <ShieldAlert className="size-3.5" />
      <span className="hidden sm:inline">{uiText("bypass_approvals_f7b5dd0d")}</span>
    </button>
  )
}
