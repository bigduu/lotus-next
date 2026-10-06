import { uiText, useUiLocale } from "@shared/i18n/ui"
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
} from "react"
import { ArrowLeft } from "lucide-react"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import { Button } from "@/components/ui/button"
import type { SettingsTabId } from "./Settings"

export interface SettingsProps {
  open: boolean
  onClose: () => void
  /** Test seam; production always uses the canonical Settings module. */
  loadSettings?: SettingsLoader
}

export interface SettingsModule {
  SettingsContent: ComponentType<SettingsContentProps>
}

export type SettingsLoader = () => Promise<SettingsModule>

export interface SettingsContentProps {
  tab: SettingsTabId
  onTabChange: (tab: SettingsTabId) => void
}

function SettingsLoading() {
  useUiLocale()
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
    >
      {uiText("loading_settings_69ede7ee")}</div>
  )
}

function SettingsLoadFailure({ onClose }: { onClose: () => void }) {
  useUiLocale()
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center"
    >
      <div className="text-base font-semibold">{uiText("could_not_load_settings_05a4babd")}</div>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {uiText("settings_code_could_not_be_loaded_chat_is_still_availab_05bc021f")}</p>
      <Button className="mt-4" onClick={onClose}>
        {uiText("back_to_chat_5b8ac6b1")}</Button>
    </div>
  )
}

const defaultLoadSettings: SettingsLoader = () => import("./Settings")

/** The stable page shell around the lazy Settings feature. */
export function LazySettings({
  open,
  onClose,
  loadSettings = defaultLoadSettings,
}: SettingsProps) {
  useUiLocale()
  // Both owners are initialized once for this boundary instance. Closing the
  // page preserves the accepted tab while the lazy type stays cached.
  const [tab, setTab] = useState<SettingsTabId>("general")
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [SettingsFeature] = useState(() =>
    lazy(async () => {
      const loaded = await loadSettings()
      return { default: loaded.SettingsContent }
    }),
  )

  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  return (
    <main
      data-slot="settings-page"
      aria-labelledby={titleId}
      className="motion-page-enter animate-in fade-in-0 slide-in-from-bottom-2 flex h-full min-h-0 w-full flex-1 flex-col bg-background"
      style={{ animationDuration: "var(--motion-normal)", animationTimingFunction: "var(--motion-ease)" }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return
        const target = event.target
        if (target instanceof Element && target.closest(
          '[role="dialog"], [role="alertdialog"], [role="combobox"], [role="listbox"], [role="menu"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], select',
        )) {
          // Portaled controls still bubble through their React page owner.
          // Their Escape behavior belongs to the nested control.
          return
        }
        event.preventDefault()
        onClose()
      }}
    >
      <header
        className="flex shrink-0 items-center gap-4 border-b p-4 sm:px-6"
        style={{ borderBottomColor: "color-mix(in oklab, var(--border) 70%, transparent)" }}
      >
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          {uiText("back_to_chat_5b8ac6b1")}
        </Button>
        <div className="h-5 w-px bg-border" aria-hidden="true" />
        <h1 ref={titleRef} id={titleId} tabIndex={-1} className="text-base font-semibold tracking-tight outline-none sm:text-lg">
          {uiText("system_settings_68ea5dd4")}
        </h1>
      </header>
      <ErrorBoundary
        name="Settings"
        fallback={<SettingsLoadFailure onClose={onClose} />}
      >
        <Suspense fallback={<SettingsLoading />}>
          <SettingsFeature tab={tab} onTabChange={setTab} />
        </Suspense>
      </ErrorBoundary>
    </main>
  )
}
