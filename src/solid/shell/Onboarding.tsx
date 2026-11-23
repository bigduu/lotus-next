import { createSignal, Show } from "solid-js"
import { BrandMark } from "../ui/brand-mark"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import { createUiText } from "./uiText"

const key = "bodhi_onboarded_v1"

function isDone(): boolean {
  try { return localStorage.getItem(key) === "1" }
  catch { return true }
}

export function Onboarding() {
  const text = createUiText()
  const [done, setDone] = createSignal(isDone())
  return (
    <Show when={!done()}>
      <ResponsiveDialog open>
        <ResponsiveDialogContent dismissable={false} showCloseButton={false}
          class="p-6 text-center sm:max-w-sm">
          <BrandMark class="mx-auto mb-3 size-12" />
          <ResponsiveDialogTitle class="text-lg">{text("welcome_to_bodhi_094c7fae")}</ResponsiveDialogTitle>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            {text("an_ai_assistant_for_mobile_use_the_top_left_menu_to_swi_cf369af5")} <code>/</code>
            {text("to_choose_skills_paste_or_select_images_and_use_the_top_acab9973")}
          </p>
          <Button class="mt-5 w-full" onClick={() => {
            try { localStorage.setItem(key, "1") } catch { /* Dismiss for this tab. */ }
            setDone(true)
          }}>{text("get_started_715ee9dc")}</Button>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Show>
  )
}
