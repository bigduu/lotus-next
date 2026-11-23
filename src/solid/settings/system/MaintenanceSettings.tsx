import { AlertTriangle } from "@lucide/solid"
import { createSignal, For, onSettled, Show } from "solid-js"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"
import { getErrorMessage } from "@services/api"
import { agentClient } from "@services/chat/AgentService"
import { serviceFactory } from "@services/common/ServiceFactory"
import { selectSessionById, appStore } from "@shared/store/appStore/state"
import { isVdiSafeModeEnabled, onVdiSafeModeChange, setVdiSafeModeEnabled, VDI_SAFE_MODE_CHANGE_EVENT } from "@shared/utils/vdiSafeMode"
import { ConversationClearDialog } from "../../chat/ConversationClearDialog"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Button } from "../../ui/button"
import { ConfirmSystemAction, SettingToggle, StatusLine, SystemSection, type SectionMessage } from "./SystemFields"

const cleanupModes = [
  { mode: "all", label: "delete_all_sessions_ddae77af", description: "all_sessions_19c6c208" },
  { mode: "empty", label: "delete_empty_sessions_1a185d3a", description: "all_empty_sessions_5ed386ae" },
  { mode: "children", label: "delete_child_sessions_a50c6edd", description: "all_child_sessions_343eb995" },
] as const
type Cleanup = typeof cleanupModes[number]
type SessionAction = { type: "dev-reset" } | { type: "cleanup"; cleanup: Cleanup; keepPinned: boolean } | { type: "clear"; id: string; title: string }

export function SessionMaintenanceSettings(props: { advanced: boolean }) {
  const text = createUiText()
  const current = createStoreSelector(appStore, (state) => selectSessionById(state.currentSessionId)(state))
  const [keepPinned, setKeepPinned] = createSignal(true)
  const [pending, setPending] = createSignal<SessionAction | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [message, setMessage] = createSignal<SectionMessage>(null)

  const open = (action: SessionAction) => { setError(null); setMessage(null); setPending(action) }
  const run = async (action: Exclude<SessionAction, { type: "clear" }>) => {
    if (busy() || pending() !== action || !props.advanced) return
    setBusy(true)
    setError(null)
    try {
      if (action.type === "cleanup") await agentClient.cleanupSessions(action.cleanup.mode, action.keepPinned)
      else await agentClient.devResetSessions()
      await appStore.getState().loadChats()
      setMessage({ kind: "ok", text: text(action.type === "cleanup" ? "cleanup_complete_6d256e25" : "session_storage_reset_30160c67") })
      setPending(null)
    } catch (failure) {
      setError(getErrorMessage(failure))
    } finally { setBusy(false) }
  }
  const copy = (action: Exclude<SessionAction, { type: "clear" }>) => action.type === "cleanup" ? {
    title: `${text(action.cleanup.label)}?`,
    description: text("delete_this_cannot_be_undone_185d9a6f", {
      v0: text(action.cleanup.description), v1: text(action.keepPinned ? "pinned_kept" : "pinned_included"),
    }),
    confirmLabel: text("delete_2f9daa82"),
  } : {
    title: text("reset_session_storage_40780a5f"),
    description: text("for_development_delete_all_backend_session_data_and_reb_86af26c4"),
    confirmLabel: text("reset_cb5d682b"),
  }

  return (
    <SystemSection title={text("session_maintenance_6ce8056e")}>
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">{text("current_session_9800a458")}</div>
        <Show when={current()} fallback={<p class="text-xs text-muted-foreground">{text("no_active_session_d3a91aa2")}</p>}>{(session) => (
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-sm">{session().title || session().id}</div>
              <div class="truncate text-xs text-muted-foreground">{text(session().kind === "child" ? "child_7f54b15e" : "root_session_label")} · {session().id}</div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => open({ type: "clear", id: session().id, title: session().title || session().id })}>
              {text("conversation_clear_action")}
            </Button>
          </div>
        )}</Show>
      </div>
      <Show when={props.advanced}>
        <div class="space-y-2 border-t pt-2">
          <SettingToggle label={text("keep_pinned_sessions_during_bulk_cleanup_66ca3998")} checked={keepPinned()} onChange={setKeepPinned} />
          <div class="flex flex-wrap gap-2">
            <For each={cleanupModes}>{(cleanup) => (
              <Button size="sm" variant="destructive" onClick={() => open({ type: "cleanup", cleanup, keepPinned: keepPinned() })}>
                {text(cleanup.label)}
              </Button>
            )}</For>
          </div>
        </div>
        <div class="space-y-1 border-t pt-2">
          <div class="text-xs text-muted-foreground">{text("development_reset_delete_all_backend_session_data_and_r_0331fbb6")}</div>
          <Button size="sm" variant="destructive" onClick={() => open({ type: "dev-reset" })}>{text("reset_session_storage_226dd63a")}</Button>
        </div>
      </Show>
      <StatusLine message={message()} />
      <Show when={pending()} keyed>{(action) => action.type === "clear" ? (
        <ConversationClearDialog sessionId={action.id} title={action.title} onClose={() => setPending(null)} />
      ) : (
        <ConfirmSystemAction open={props.advanced} title={copy(action).title} description={copy(action).description} confirmLabel={copy(action).confirmLabel}
          busy={busy()} error={error()} onClose={() => setPending(null)} onConfirm={() => { void run(action) }} />
      )}</Show>
    </SystemSection>
  )
}

type AppAction = "clear-storage" | "reset-app"

export function AppMaintenanceSettings(props: { ownerAccess: boolean }) {
  const text = createUiText()
  const { artifact, publicMetadata } = getRuntimeConfig()
  const [pending, setPending] = createSignal<AppAction | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [message, setMessage] = createSignal<SectionMessage>(null)
  const [vdiMode, setVdiMode] = createSignal(isVdiSafeModeEnabled())
  onSettled(() => onVdiSafeModeChange(() => setVdiMode(isVdiSafeModeEnabled())))

  const toggleVdi = (checked: boolean) => {
    setVdiSafeModeEnabled(checked)
    window.dispatchEvent(new Event(VDI_SAFE_MODE_CHANGE_EVENT))
  }
  const open = (action: AppAction) => { setError(null); setMessage(null); setPending(action) }
  const run = async (action: AppAction) => {
    if (busy() || pending() !== action || (action === "reset-app" && !props.ownerAccess)) return
    setBusy(true)
    setError(null)
    try {
      if (action === "reset-app") {
        await agentClient.cleanupSessions("all", false)
        await serviceFactory.resetSetupStatus()
        await serviceFactory.resetBambooConfig()
      }
      localStorage.clear()
      setPending(null)
      setMessage({ kind: "ok", text: text(action === "reset-app" ? "reset_complete_reloading_12514457" : "local_storage_cleared_reloading_ec1328a5") })
      setTimeout(() => window.location.reload(), action === "reset-app" ? 1200 : 600)
    } catch (failure) {
      setError(getErrorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <SystemSection title={text("apply_63c73c47")}>
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">{text("frontend_version_1986e080")}</span>
        <span class="font-mono text-xs">v{artifact.version}{publicMetadata.development ? " (dev)" : ""}</span>
      </div>
      <div class="border-t pt-2">
        <SettingToggle label={text("graphics_compatibility_mode_49d20649")} description={text("disable_blur_and_glass_effects_for_virtual_desktops_vdi_26252605")}
          checked={vdiMode()} onChange={toggleVdi} />
      </div>
      <div class="flex items-center justify-between gap-2 border-t pt-2">
        <p class="text-xs text-muted-foreground">{text("clear_browser_local_storage_and_reload_the_page_2a696421")}</p>
        <Button size="sm" variant="secondary" disabled={busy()} onClick={() => open("clear-storage")}>{text("clear_local_storage_4ee71bf2")}</Button>
      </div>
      <Show when={props.ownerAccess}>
        <div class="space-y-1.5 border-t pt-2">
          <p class="flex items-center gap-1.5 text-xs font-medium text-destructive"><AlertTriangle class="size-3.5" />{text("danger_zone_d0baa11d")}</p>
          <p class="text-xs leading-relaxed text-muted-foreground">{text("full_reset_delete_all_sessions_including_pinned_ones_re_d92ddf8e")}</p>
          <Button size="sm" variant="destructive" disabled={busy()} onClick={() => open("reset-app")}>{text("reset_application_23f30713")}</Button>
        </div>
      </Show>
      <StatusLine message={message()} />
      <Show when={pending()} keyed>{(action) => (
        <ConfirmSystemAction open busy={busy()} error={error()} onClose={() => setPending(null)} onConfirm={() => { void run(action) }}
          title={text(action === "reset-app" ? "reset_the_entire_app_60e36122" : "clear_local_storage_1b86d7c0")}
          description={text(action === "reset-app" ? "delete_all_sessions_including_pinned_ones_reset_backend_b03a8b2a" : "this_clears_browser_localstorage_local_preferences_and__acf1cd5f")}
          confirmLabel={text(action === "reset-app" ? "confirm_reset_96f2cb4f" : "clear_and_reload_f19b6e32")} />
      )}</Show>
    </SystemSection>
  )
}
