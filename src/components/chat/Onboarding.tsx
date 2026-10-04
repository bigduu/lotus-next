import { uiText, useUiLocale } from "@shared/i18n/ui"
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
  useUiLocale()
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
          {uiText("welcome_to_bodhi_094c7fae")}</ResponsiveDialogTitle>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {uiText("an_ai_assistant_for_mobile_use_the_top_left_menu_to_swi_cf369af5")} <code>/</code>{uiText("to_choose_skills_paste_or_select_images_and_use_the_top_acab9973")}</p>
        <Button className="mt-5 w-full" onClick={finish}>
          {uiText("get_started_715ee9dc")}</Button>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
