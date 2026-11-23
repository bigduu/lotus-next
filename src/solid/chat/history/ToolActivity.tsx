import { ChevronRight, Columns2, FileDiff, LoaderCircle, Rows3, WrapText } from "@lucide/solid"
import { Dynamic } from "@solidjs/web"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"

import { safeViewImageSource } from "@/lib/chat/viewImageSources"
import { sessionMessagePresentation } from "@/lib/chat/sessionMessagePresentation"
import { cn } from "@/lib/utils"
import i18n from "@shared/i18n/runtime"
import { appStore } from "@shared/store/appStore/state"
import { getFileChangePayloadDiffStats, parseFileChangeResultPayload, type FileChangeResultPayload } from "@shared/utils/resultFormatters"

import { createUiLocale, createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Badge } from "../../ui/badge"
import { DiffBody } from "../../workbench/ReviewPane"
import type { ProcessPart } from "./historyProjection"
import { approvalStatus, buildEntries, cleanParams, presentTool, prettyResult, type Entry } from "./toolPresentation"

type ToolPart = Extract<ProcessPart, { kind: "tools" }>
export type HistoryDisclosure = { isOpen: (key: string) => boolean; toggle: (key: string) => void }
const headingClass = "flex min-w-0 flex-wrap items-center gap-1.5 rounded-sm py-1 text-sm text-muted-foreground"

function BackgroundBadge(props: { bashId: string }) {
  const locale = createUiLocale()
  const results = createStoreSelector(appStore, (state) => state.backgroundBash)
  const result = () => results()[props.bashId]
  const label = (key: string) => i18n.t(`chat.tools.${key}`, { lng: locale() })
  const finished = () => result()?.status === "completed" && (result()?.exitCode === 0 || result()?.exitCode == null)
  const suffix = () => result()?.exitCode == null ? "" : ` · exit ${result()?.exitCode}`
  return (
    <Show when={result()} fallback={
      <Badge variant="warning"><LoaderCircle class="size-3 animate-spin" />{label("runningInBackground")}</Badge>
    }>
      <Show when={result()?.status !== "killed"} fallback={<Badge variant="secondary">{label("backgroundKilled")}</Badge>}>
        <Badge variant={finished() ? "success" : "destructive"}>
          {label(finished() ? "backgroundCompleted" : "backgroundFailed")}{suffix()}
        </Badge>
      </Show>
    </Show>
  )
}

function EntryHeading(props: { entry: Entry; running: boolean; open?: boolean }) {
  const text = createUiText()
  const locale = createUiLocale()
  const presentation = createMemo(() => {
    locale()
    return presentTool(props.entry)
  })
  const messageReceipt = () => sessionMessagePresentation(props.entry.toolName, props.entry.params, props.entry.result)
  return <>
    <Dynamic component={presentation().icon} class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="min-w-0 break-words [overflow-wrap:anywhere]">{presentation().label}</span>
    <Show when={presentation().detail}>{(detail) => (
      <span title={detail()} class="min-w-0 break-words text-xs opacity-70 [overflow-wrap:anywhere]">{detail()}</span>
    )}</Show>
    <Show when={props.entry.result?.isError}><span class="shrink-0 text-destructive">{text("errors_01ad2bc5")}</span></Show>
    <Show when={props.entry.background}>{(background) => <BackgroundBadge bashId={background().bashId} />}</Show>
    <Show when={props.running && !messageReceipt()}><span class="shrink-0">{text("running_14d9f2d8")}</span></Show>
    <Show when={props.open !== undefined}>
      <ChevronRight class={cn("size-3 shrink-0 transition-transform", props.open && "rotate-90")} aria-hidden="true" />
    </Show>
  </>
}

function FileChange(props: { payload: FileChangeResultPayload }) {
  const text = createUiText()
  const [width, setWidth] = createSignal(0)
  const [wrap, setWrap] = createSignal(false)
  const [compare, setCompare] = createSignal(false)
  const split = () => compare() && width() >= 720
  const stats = createMemo(() => getFileChangePayloadDiffStats(props.payload))
  const fileName = () => props.payload.file_path.split(/[\\/]/).filter(Boolean).at(-1) ?? props.payload.file_path
  let container!: HTMLDivElement
  onSettled(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  })
  return (
    <div ref={(element) => { container = element }} class="mt-1.5 overflow-hidden rounded-md border bg-background/50">
      <div class="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5">
        <FileDiff class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono text-[11px]" title={props.payload.file_path}>{fileName()}</span>
        <span class="shrink-0 text-[11px]">
          <span class="text-green-600 dark:text-green-400">+{stats().added}</span>{" "}
          <span class="text-red-600 dark:text-red-400">−{stats().removed}</span>
        </span>
        <Show when={props.payload.diff.truncated}>
          <span class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{text("truncated_4fb9aa6e")}</span>
        </Show>
        <button type="button" class={cn("shrink-0 rounded p-0.5 hover:bg-accent", wrap() && "bg-accent text-foreground")}
          aria-label={text(wrap() ? "no_wrapping_5e4313a9" : "wrap_lines_b096842c")} aria-pressed={wrap() ? "true" : "false"}
          onClick={() => setWrap(!wrap())}><WrapText class="size-3.5" /></button>
        <Show when={width() >= 720}>
          <button type="button" class="shrink-0 rounded p-0.5 hover:bg-accent"
            aria-label={text(split() ? "unified_view_ed58c78e" : "side_by_side_view_0b210103")} onClick={() => setCompare(!split())}>
            <Show when={split()} fallback={<Columns2 class="size-3.5" />}><Rows3 class="size-3.5" /></Show>
          </button>
        </Show>
      </div>
      <div class="max-h-72 overflow-auto">
        <DiffBody value={props.payload.diff.unified} path={fileName()} wrap={wrap()} split={split()} />
      </div>
    </div>
  )
}

function EntryDetail(props: { entry: Entry; label: string; onPreviewImage: (url: string) => void }) {
  const text = createUiText()
  const params = createMemo(() => cleanParams(props.entry.params))
  const images = createMemo(() => props.entry.images?.map(safeViewImageSource).filter((src) => src !== null) ?? [])
  const fileChange = createMemo(() => props.entry.result?.text ? parseFileChangeResultPayload(props.entry.result.text) : null)
  const result = createMemo(() => props.entry.result?.text ? prettyResult(props.entry.result.text) : "")
  return (
    <div data-tool-call-entry-detail="" class="mt-1 border-l border-border pl-4 text-[11px]">
      <Show when={props.label !== props.entry.toolName}>
        <div class="break-all text-muted-foreground opacity-70">{props.entry.toolName}</div>
      </Show>
      <Show when={images().length}>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <For each={images()}>{(url, index) => (
            <button type="button" aria-label={text("preview_tool_image_344014b6", { v0: index() + 1 })}
              class="cursor-zoom-in" onClick={() => props.onPreviewImage(url)}>
              <img src={url} alt={text("tool_image_7b8fcc11", { v0: index() + 1 })} class="max-h-48 max-w-full rounded-xl object-contain" />
            </button>
          )}</For>
        </div>
      </Show>
      <Show when={params().primary}>
        <div class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-foreground [overflow-wrap:anywhere]">
          {params().primary}
        </div>
      </Show>
      <Show when={params().rest.length}>
        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
          <For each={params().rest} keyed={([key]) => key}>{(parameter) => (
            <span class="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              <span class="opacity-60">{parameter()[0]}:</span> {parameter()[1]}
            </span>
          )}</For>
        </div>
      </Show>
      <Show when={fileChange()} fallback={
        <Show when={result()}>
          <pre class="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">{result()}</pre>
        </Show>
      }>{(payload) => <FileChange payload={payload()} />}</Show>
    </div>
  )
}

function EntryRow(props: {
  entry: Entry
  rowKey: string
  running: boolean
  expanded: boolean
  disclosure: HistoryDisclosure
  onPreviewImage: (url: string) => void
}) {
  const locale = createUiLocale()
  const label = createMemo(() => {
    locale()
    return presentTool(props.entry).label
  })
  const open = () => props.expanded || props.disclosure.isOpen(props.rowKey)
  return (
    <div data-tool-call-entry="" class="min-w-0">
      <Show when={props.expanded} fallback={
        <details open={open()}>
          <summary data-tool-call-entry-toggle="" aria-expanded={open() ? "true" : "false"}
            onClick={(event) => { event.preventDefault(); props.disclosure.toggle(props.rowKey) }}
            class={cn(headingClass, "cursor-pointer list-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden")}>
            <EntryHeading entry={props.entry} running={props.running} open={open()} />
          </summary>
          <Show when={open()}><EntryDetail entry={props.entry} label={label()} onPreviewImage={props.onPreviewImage} /></Show>
        </details>
      }>
        <div data-tool-call-entry-heading="" class={headingClass}>
          <EntryHeading entry={props.entry} running={props.running} />
        </div>
        <EntryDetail entry={props.entry} label={label()} onPreviewImage={props.onPreviewImage} />
      </Show>
    </div>
  )
}

export function ToolActivity(props: {
  part: ToolPart
  groupKey: string
  expandedSingle?: boolean
  active?: boolean
  preview?: boolean
  previewCallId?: string
  disclosure: HistoryDisclosure
  onPreviewImage: (url: string) => void
}) {
  const locale = createUiLocale()
  const entries = createMemo(() => {
    locale()
    return buildEntries(props.part.items)
  })
  const running = (entry: Entry) => props.part.runningCallIds?.has(entry.id) ?? Boolean(props.active && !entry.result)
  const preview = createMemo(() => {
    if (!props.preview) return undefined
    return props.previewCallId ? entries().find((entry) => entry.id === props.previewCallId)
      : entries().findLast(running) ?? entries().at(-1)
  })
  const previewText = (entry: Entry) => entry.focusedBrowserInput || entry.browserEvalTool || entry.browserSelectOption
    || entry.browserFileInput || entry.browserDialogResponse || entry.browserDialogStatus || entry.browserDownload
    || entry.result?.text === approvalStatus() ? entry.result?.text : undefined

  return (
    <Show when={props.preview} fallback={
      <Show when={entries().length}>
        <div class="flex justify-start">
          <div data-tool-call-panel="" class="w-full max-w-[85%] space-y-1 px-3.5 text-xs">
            <For each={entries()} keyed={(entry) => entry.id}>{(entry) => (
              <EntryRow entry={entry()} rowKey={`${props.groupKey}:${entry().id}`} running={running(entry())}
                expanded={props.expandedSingle === true && entries().length === 1}
                disclosure={props.disclosure} onPreviewImage={props.onPreviewImage} />
            )}</For>
          </div>
        </div>
      </Show>
    }>
      <Show when={preview()}>{(entry) => (
        <div class="flex justify-start">
          <div data-tool-call-preview="" class={cn("w-full max-w-[85%] px-3.5", headingClass)}>
            <EntryHeading entry={entry()} running={running(entry())} />
            <Show when={previewText(entry())}><span class="min-w-0 truncate text-xs">{previewText(entry())}</span></Show>
          </div>
        </div>
      )}</Show>
    </Show>
  )
}
