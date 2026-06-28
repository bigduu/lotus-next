import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

const KEY = "bodhi_onboarded_v1"

/** First-run welcome. Self-hides once dismissed (localStorage flag). */
export function Onboarding() {
  const [done, setDone] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1"
    } catch {
      return true
    }
  })
  if (done) return null

  const finish = () => {
    try {
      localStorage.setItem(KEY, "1")
    } catch {
      /* ignore */
    }
    setDone(true)
  }

  return (
    <ResponsiveDialog open>
      <ResponsiveDialogContent
        dismissable={false}
        showCloseButton={false}
        className="p-6 text-center sm:max-w-sm"
      >
        <div className="mx-auto mb-3 size-12 rounded-2xl bg-primary" />
        <ResponsiveDialogTitle className="text-lg">
          欢迎使用 Bodhi
        </ResponsiveDialogTitle>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          移动优先的 AI 助手。左上角菜单切换会话,输入 <code>/</code> 选择技能,可粘贴或选择图片,
          右上角「检查器」查看任务、配置与子代理。
        </p>
        <Button className="mt-5 w-full" onClick={finish}>
          开始使用
        </Button>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
