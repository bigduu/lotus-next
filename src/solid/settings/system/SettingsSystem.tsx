import { createSignal, Show } from "solid-js"
import { experienceModeStore } from "@shared/store/experienceModeState"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Button } from "../../ui/button"
import { Skeleton } from "../../ui/skeleton"
import { AccessPasswordSettings } from "./AccessPasswordSettings"
import { createSystemConfig } from "./createSystemConfig"
import { AppMaintenanceSettings, SessionMaintenanceSettings } from "./MaintenanceSettings"
import { ProjectScanSettings } from "./ProjectScanSettings"
import { ContextManagementSettings, ImageHookSettings, MemorySettings, ProxySettings, SubagentSettings, ToolSettings } from "./RuntimeConfigSections"
import { TailscaleSettings } from "./TailscaleSettings"
import { WorkSettings } from "./WorkSettings"

export function SettingsSystem(props: { ownerAccess: boolean }) {
  const text = createUiText()
  const advanced = createStoreSelector(experienceModeStore, (state) => state.isAdvanced)
  const system = createSystemConfig(() => props.ownerAccess)
  const [passwordRevision, setPasswordRevision] = createSignal(0)
  const workFlags = () => {
    const flags = system.config()?.features
    if (typeof flags?.ticket_mutation !== "boolean" || typeof flags.ticket_dispatch !== "boolean") return null
    return { ...flags, ticket_mutation: flags.ticket_mutation, ticket_dispatch: flags.ticket_dispatch }
  }

  return (
    <div class="space-y-3">
      <Show when={props.ownerAccess}>
        <Show when={system.loading()}>
          <div role="status" aria-label={text("loading_4927a53b")} class="space-y-3">
            <Skeleton class="h-24 w-full rounded-lg" />
            <Skeleton class="h-24 w-full rounded-lg" />
            <Skeleton class="h-24 w-full rounded-lg" />
          </div>
        </Show>
        <Show when={system.loadError()}>{(error) => (
          <section class="space-y-2 rounded-lg border p-3">
            <p role="alert" class="text-xs text-destructive">{text("could_not_load_configuration_395e6a71")}{error()}</p>
            <Button size="sm" variant="secondary" onClick={() => { void system.reload() }}>{text("retry_b8784c8d")}</Button>
          </section>
        )}</Show>
        <Show when={workFlags()}>{(flags) => (
          <>
            <WorkSettings flags={flags()} saveSection={system.saveSection} />
            <ProjectScanSettings />
          </>
        )}</Show>
        <Show when={advanced() && system.config()}>{(config) => (
          <>
            <ProxySettings config={config()} saveSection={system.saveSection} />
            <ContextManagementSettings config={config()} saveSection={system.saveSection} />
            <MemorySettings config={config()} saveSection={system.saveSection} />
            <SubagentSettings config={config()} saveSection={system.saveSection} />
            <ToolSettings config={config()} saveSection={system.saveSection} />
            <ImageHookSettings config={config()} saveSection={system.saveSection} />
          </>
        )}</Show>
        <TailscaleSettings passwordRevision={passwordRevision()} />
        <AccessPasswordSettings configReady={!!system.config() && !system.loading()} saveSection={system.saveSection}
          onChange={() => setPasswordRevision((previous) => previous + 1)} />
        <SessionMaintenanceSettings advanced={advanced()} />
      </Show>
      <AppMaintenanceSettings ownerAccess={props.ownerAccess} />
    </div>
  )
}
