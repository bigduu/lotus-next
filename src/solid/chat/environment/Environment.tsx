import { ChevronRight, File, FileDiff, FolderGit2, FolderKanban, Image as ImageIcon, ListFilter, Monitor } from "@lucide/solid"
import { createEffect, For, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { isCommandComposing } from "@/lib/commandComposition"
import type { SessionPlacement } from "@services/chat/AgentService"
import type { SessionFileChangeSummary } from "@/lib/sessionFileChanges"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import type { EnvironmentController } from "./createEnvironment"
import { environmentPathName, type EnvironmentSource } from "./environmentSources"

function EnvironmentRow(props: {
  icon: JSX.Element
  label: string
  detail?: string | null
  trailing?: JSX.Element
  onClick?: () => void
  ariaLabel?: string
}) {
  const content = () => <>
    <span class="text-muted-foreground">{props.icon}</span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium">{props.label}</span>
      <Show when={props.detail}>
        <span class="block truncate text-xs text-muted-foreground" title={props.detail ?? undefined}>{props.detail}</span>
      </Show>
    </span>
    {props.trailing}
  </>
  return <Show when={props.onClick} fallback={<div class="flex items-center gap-3 px-3 py-2">{content()}</div>}>
    <button type="button" aria-label={props.ariaLabel}
      class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => props.onClick?.()}>
      {content()}
    </button>
  </Show>
}

export function EnvironmentLauncher(props: { environment: EnvironmentController }) {
  const text = createUiText()
  const environment = props.environment
  return <Button type="button" size="icon" variant="ghost"
    aria-label={text(environment.visible() ? "collapse_environment_4c6b8293" : "open_environment_052cba79")}
    aria-expanded={environment.visible() ? "true" : "false"} aria-controls={environment.controlsId}
    disabled={environment.disabled()} onClick={environment.toggle}>
    <ListFilter />
  </Button>
}

function SourceRow(props: {
  source: EnvironmentSource
  text: ReturnType<typeof createUiText>
  onPreviewImage: (url: string) => void
}) {
  const image = () => props.source.kind === "image" ? props.source.previewUrl : undefined
  function preview() {
    const url = image()
    if (url) props.onPreviewImage(url)
  }
  return <EnvironmentRow
    icon={<Show when={image()} fallback={props.source.kind === "image" ? <ImageIcon class="size-4" /> : <File class="size-4" />}>
      <img src={image()} alt="" class="size-8 rounded-md border object-cover" />
    </Show>}
    label={props.source.name}
    trailing={<Show when={image()}><ChevronRight class="size-4 text-muted-foreground" /></Show>}
    onClick={image() ? preview : undefined}
    ariaLabel={image() ? props.text("preview_2078e163", { v0: props.source.name }) : undefined}
  />
}

export function EnvironmentCard(props: {
  environment: EnvironmentController
  workspace?: string | null
  projectName?: string | null
  placement?: SessionPlacement | null
  changes: SessionFileChangeSummary
  sources: readonly EnvironmentSource[]
  historyStatus?: string
  subagentStatus?: JSX.Element
  hasEarlier?: boolean
  onOpenReview: () => void
  onPreviewImage: (url: string) => void
}) {
  const text = createUiText()
  const environment = props.environment
  const canLoadEarlier = () => environment.preference() === "auto" && props.hasEarlier && !props.historyStatus
  const countsIncomplete = () => Boolean(props.historyStatus || canLoadEarlier())
  const workspaceLabel = () => props.workspace ? environmentPathName(props.workspace) : text("no_workspace_set_ed50070e")
  const placementLabel = () => props.placement
    ? props.placement.kind === "local" ? "Local" : props.placement.kind
    : text("execution_location_unconfirmed_64b94db6")
  let island!: HTMLDivElement
  const launcher = `button[aria-controls="${environment.controlsId}"]`

  createEffect(environment.visible, (visible) => {
    if (!visible) return
    const document = island.ownerDocument
    const belongsToIsland = (target: EventTarget | null) =>
      target instanceof Element && (island.contains(target) || !!target.closest(launcher))
    const isOtherLayer = (target: EventTarget | null) => target instanceof Element &&
      !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')
    const modalOpen = () => !!document.querySelector('[aria-modal="true"][data-state="open"]')
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (environment.floating() || event.defaultPrevented || event.button !== 0 || belongsToIsland(event.target) || modalOpen()) return
      // The close control can be detached and the island restored before the click reaches the window.
      const fromLayer = event.composedPath().some((target) =>
        isOtherLayer(target) || (target instanceof Element && target.matches('#right-workbench, [aria-controls="right-workbench"]')))
      if (!fromLayer) environment.dismiss()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isCommandComposing(event) || !environment.visible()) return
      if (environment.floating() && !belongsToIsland(event.target)) return
      if (modalOpen() || isOtherLayer(event.target)) return
      const focusWasInside = island.contains(document.activeElement)
      environment.dismiss()
      event.preventDefault()
      if (focusWasInside) document.querySelector<HTMLElement>(launcher)?.focus({ preventScroll: true })
    }
    document.defaultView?.addEventListener("click", closeOnOutsideClick)
    document.defaultView?.addEventListener("keydown", closeOnEscape)
    return () => {
      document.defaultView?.removeEventListener("click", closeOnOutsideClick)
      document.defaultView?.removeEventListener("keydown", closeOnEscape)
    }
  })

  return <div ref={(element) => { island = element }} data-environment-floating=""
    data-placement={environment.floating() ? "floating" : "inline"} data-state={environment.visible() ? "open" : "closed"}
    aria-hidden={environment.visible() ? "false" : "true"} inert={!environment.visible()}
    class={`min-h-0 w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl ${environment.floating()
      ? "absolute right-3 top-3 z-30" : "relative mx-3 self-end"}`}
    style={{
      opacity: environment.visible() ? 1 : 0,
      transform: environment.floating() && !environment.visible() ? "translateX(0.75rem) scale(0.98)" : undefined,
      "transform-origin": "top right",
      "max-height": environment.floating() ? "calc(100% - 1.5rem)" : environment.visible() ? "min(36dvh, 16rem)" : "0px",
      "margin-top": !environment.floating() && environment.visible() ? "0.75rem" : undefined,
      visibility: environment.visible() ? "visible" : "hidden",
      "pointer-events": environment.visible() ? "auto" : "none",
      transition: environment.floating()
        ? "opacity 200ms ease-out, transform 200ms ease-out, visibility 200ms ease-out"
        : "opacity 200ms ease-out, max-height 200ms ease-out, margin-top 200ms ease-out, visibility 200ms ease-out",
    }}>
    <section id={environment.controlsId} aria-label="Environment" data-environment-card=""
      class="w-full rounded-2xl border bg-popover p-2 text-popover-foreground shadow-lg">
      <div class="px-3 pb-2 pt-1 text-sm font-semibold">Environment</div>
      <EnvironmentRow icon={<FileDiff class="size-4" />} label="Changes"
        detail={countsIncomplete() ? undefined : text("changed_files_b757f839", { v0: props.changes.fileCount, count: props.changes.fileCount })}
        trailing={<Show when={!countsIncomplete()}>
          <span class="flex shrink-0 items-center gap-1 text-xs tabular-nums">
            <span class="text-green-600 dark:text-green-400">+{props.changes.addedLines}</span>
            <span class="text-red-600 dark:text-red-400">−{props.changes.removedLines}</span>
            <ChevronRight class="size-4 text-muted-foreground" />
          </span>
        </Show>}
        onClick={() => props.onOpenReview()} />
      <Show when={props.subagentStatus}>
        <div class="space-y-1 px-3">{props.subagentStatus}</div>
      </Show>
      <EnvironmentRow icon={<Monitor class="size-4" />} label={placementLabel()} detail={props.placement?.host} />
      <EnvironmentRow icon={<FolderGit2 class="size-4" />} label={workspaceLabel()} detail={props.workspace} />
      <Show when={props.projectName}>{(name) =>
        <EnvironmentRow icon={<FolderKanban class="size-4" />} label={name()} detail="Project" />
      }</Show>
      <div class="mx-2 my-2 border-t" />
      <div class="flex items-center justify-between px-3 pb-1 text-sm text-muted-foreground">
        <span>Sources</span>
        <Show when={!countsIncomplete()}><span class="text-xs tabular-nums">{props.sources.length}</span></Show>
      </div>
      <Show when={props.historyStatus}>
        <p role="status" class="px-3 py-2 text-xs text-muted-foreground">{props.historyStatus}</p>
      </Show>
      <Show when={canLoadEarlier()}>
        <Button type="button" variant="ghost" size="sm" onClick={environment.loadEarlier}>{text("load_earlier_sources")}</Button>
      </Show>
      <Show when={props.sources.length} fallback={<Show when={!countsIncomplete()}>
        <div class="px-3 py-2 text-xs text-muted-foreground">{text("this_session_has_no_source_files_yet_b1b2a050")}</div>
      </Show>}>
        <div class="space-y-0.5">
          <For each={props.sources.slice(0, 5)} keyed={(source) => source.id}>
            {(source) => <SourceRow source={source()} text={text} onPreviewImage={props.onPreviewImage} />}
          </For>
        </div>
      </Show>
    </section>
  </div>
}
