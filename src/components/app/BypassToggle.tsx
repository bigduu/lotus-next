import { ShieldAlert } from "lucide-react"

/** Header pill shown while a session has permission-approval bypassed. */
export function BypassToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="已绕过权限审批 — 点击关闭"
      className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400"
    >
      <ShieldAlert className="size-3.5" />
      <span className="hidden sm:inline">绕过权限</span>
    </button>
  )
}
