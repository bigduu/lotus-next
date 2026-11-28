import { createMemo, createSignal, Show } from "solid-js"
import { appStore } from "@shared/store/appStore/state"

import { createProjectScan, projectScanModeText, type ScanAction } from "../../project-work/createProjectScan"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Select } from "../../ui/select"
import { SystemSection } from "./SystemFields"

const primaryControls = {
  off: { action: "enable", label: "project_scan_enable" },
  enabled: { action: "pause", label: "project_scan_pause" },
  paused: { action: "resume", label: "project_scan_resume" },
} as const

export function ProjectScanSettings() {
  const text = createUiText()
  const projects = createStoreSelector(appStore, (state) => state.projects)
  const options = createMemo(() => Object.values(projects())
    .filter((project) => project.status === "active")
    .map((project) => ({ value: project.id, label: project.name })))
  const [chosenProject, setChosenProject] = createSignal("")
  const projectId = createMemo(() => options().some(({ value }) => value === chosenProject())
    ? chosenProject() : options()[0]?.value ?? "")
  const scan = createProjectScan(projectId, { pollWhileOff: true })
  let primaryButton: HTMLButtonElement | undefined

  const change = async (action: ScanAction, button: HTMLButtonElement) => {
    const id = projectId()
    const restoreFocus = document.activeElement === button
    await scan.command(action)
    if (restoreFocus) requestAnimationFrame(() => {
      if (projectId() === id && document.activeElement === document.body) {
        const target = button.isConnected ? button : primaryButton
        if (target?.isConnected) target.focus()
      }
    })
  }

  return (
    <SystemSection title={text("project_scan_title")}>
      <Show when={projectId()} fallback={<p class="text-xs text-muted-foreground">{text("worktrees_no_projects")}</p>}>
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div class="flex min-w-0 max-w-full items-center gap-2">
            <span class="shrink-0 text-sm">{text("project_79f326be")}</span>
            <Select selectOnly label={text("project_79f326be")} size="sm" class="min-w-0 max-w-full"
              options={options()} value={projectId()} disabled={scan.sending()} onValueChange={setChosenProject} />
          </div>
          <Show when={scan.status()}>{(value) => {
            const primary = () => primaryControls[value().mode]
            const canEnable = () => value().available && !!value().model
            return (
              <div class="flex flex-wrap items-center gap-2" aria-busy={scan.sending() ? "true" : "false"}>
                <Badge variant={value().mode === "enabled" ? "secondary" : "outline"} role="status">
                  {text(projectScanModeText[value().mode])}
                </Badge>
                <Button ref={(button) => { primaryButton = button }} size="sm" variant="outline"
                  disabled={scan.sending() || (value().mode !== "enabled" && !canEnable())}
                  onClick={(event) => void change(primary().action, event.currentTarget)}>{text(primary().label)}</Button>
                <Show when={value().mode !== "off"}>
                  <Button size="sm" variant="ghost" disabled={scan.sending()}
                    onClick={(event) => void change("disable", event.currentTarget)}>{text("project_scan_disable")}</Button>
                </Show>
              </div>
            )
          }}</Show>
        </div>
        <Show when={scan.status()}>{(value) => (
          <>
            <Show when={!value().model}>
              <p class="text-xs text-muted-foreground">{text("project_scan_model_required")}</p>
            </Show>
            <Show when={!value().available}>
              <p class="text-xs text-muted-foreground">{text("project_scan_dispatch_required")}</p>
            </Show>
          </>
        )}</Show>
        <Show when={!scan.status() && !scan.error()}>
          <p class="text-xs text-muted-foreground" role="status">
            {text(scan.unsupported() ? "project_scan_unsupported" : "loading_4927a53b")}
          </p>
        </Show>
        <Show when={scan.error()}>{(message) => <p role="alert" class="break-words text-xs text-destructive">{message()}</p>}</Show>
      </Show>
    </SystemSection>
  )
}
