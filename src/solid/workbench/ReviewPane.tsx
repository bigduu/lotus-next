import { Columns2, FileDiff, Rows3, WrapText } from "@lucide/solid"
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import type { JSX } from "@solidjs/web"
import { displayFileChangePath } from "@/lib/chat/fileChangePresentation"
import { summarizeSessionFileChangeGroups, type SessionFileChangeGroup } from "@/lib/sessionFileChanges"
import {
  parseUnifiedDiffLines, parseUnifiedDiffSideBySideRows, type DiffLineKind,
} from "@shared/utils/resultFormatters"
import { cn } from "@/lib/utils"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"

const lineStyle: Partial<Record<DiffLineKind, string>> = {
  add: "bg-green-500/10 text-green-700 dark:text-green-400",
  modified_add: "bg-green-500/10 text-green-700 dark:text-green-400",
  remove: "bg-red-500/10 text-red-700 dark:text-red-400",
  modified_remove: "bg-red-500/10 text-red-700 dark:text-red-400",
  hunk: "bg-muted/70 text-muted-foreground",
  meta: "text-muted-foreground",
  gap: "text-muted-foreground/50",
}

export function DiffBody(props: { value: string; path: string; wrap: boolean; split: boolean }) {
  const text = createUiText()
  const duplicate = (line: string) => line.startsWith("--- ") || line.startsWith("+++ ")
  const lines = createMemo(() => props.split ? [] : parseUnifiedDiffLines(props.value).filter((line) => !duplicate(line.text)))
  const rows = createMemo(() => props.split ? parseUnifiedDiffSideBySideRows(props.value)
    .filter((line) => line.kind !== "meta" || !duplicate(line.text ?? "")) : [])
  const whitespace = () => props.wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
  return (
    <Show when={props.value.trim()}>
      <div class="overflow-x-auto font-mono text-xs leading-relaxed">
        <Show when={props.split} fallback={
          <div role="table" aria-label={text("unified_diff_3046b5d4", { v0: props.path })}>
            <For each={lines()} keyed={false}>{(line) => (
              <div role="row" class={cn("px-2.5", whitespace(), lineStyle[line().kind])}
                style={{ "min-width": props.wrap ? undefined : "max-content" }}>{line().text || " "}</div>
            )}</For>
          </div>
        }>
          <table class="w-full border-collapse" style={{ "min-width": "42rem" }}>
            <tbody>
              <For each={rows()} keyed={false}>{(row) => (
                <Show when={row().kind !== "meta" && row().kind !== "hunk"} fallback={
                  <tr><td colspan={4} class={cn("px-2 py-0.5", lineStyle[row().kind as DiffLineKind])}>{row().text}</td></tr>
                }>
                  <tr class="align-top">
                    <td class="w-8 select-none border-r px-1 text-right text-muted-foreground/60">{row().oldLineNumber}</td>
                    <td class={cn("w-1/2 px-2", whitespace(), ["remove", "modified"].includes(row().kind) && lineStyle.remove)}>
                      {row().kind === "add" ? "" : row().oldText ?? row().text}
                    </td>
                    <td class="w-8 select-none border-x px-1 text-right text-muted-foreground/60">{row().newLineNumber}</td>
                    <td class={cn("w-1/2 px-2", whitespace(), ["add", "modified"].includes(row().kind) && lineStyle.add)}>
                      {row().kind === "remove" ? "" : row().newText ?? row().text}
                    </td>
                  </tr>
                </Show>
              )}</For>
            </tbody>
          </table>
        </Show>
      </div>
    </Show>
  )
}

function FileChanges(props: { group: SessionFileChangeGroup; workspace?: string; initialOpen: boolean; selected: boolean }) {
  const text = createUiText()
  const [open, setOpen] = createSignal(untrack(() => props.initialOpen))
  const [wide, setWide] = createSignal(false)
  const [compare, setCompare] = createSignal(false)
  const [wrapLines, setWrapLines] = createSignal(false)
  const path = () => displayFileChangePath(props.group.filePath, "relative", props.workspace)
  let details!: HTMLDetailsElement

  onSettled(() => {
    const check = () => { setWide(details.getBoundingClientRect().width >= 720) }
    check()
    const resize = new ResizeObserver(check)
    resize.observe(details)
    return () => resize.disconnect()
  })
  createEffect(wide, (value) => { if (!value) setCompare(false) })
  createEffect(() => props.selected, (value) => {
    if (!value) return
    setOpen(true)
    const frame = requestAnimationFrame(() => details.scrollIntoView({ block: "start" }))
    return () => cancelAnimationFrame(frame)
  })

  return (
    <details ref={(element) => { details = element }} open={open()} onToggle={(event) => setOpen(event.currentTarget.open)}
      class="rounded-lg border bg-background/50">
      <summary class="sticky top-0 z-20 flex cursor-pointer select-none items-center gap-2 rounded-t-lg bg-card px-3 py-2.5 text-sm hover:bg-accent [&::-webkit-details-marker]:hidden">
        <FileDiff class="size-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono" title={props.group.filePath}>{path()}</span>
        <Show when={props.group.changes.length > 1}>
          <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {text("count_changes", { count: props.group.changes.length })}
          </span>
        </Show>
        <Show when={props.group.truncated}>
          <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{text("truncated_4fb9aa6e")}</span>
        </Show>
        <span class="shrink-0 text-xs">
          <span class="text-green-600 dark:text-green-400">+{props.group.addedLines}</span>{" "}
          <span class="text-red-600 dark:text-red-400">−{props.group.removedLines}</span>
        </span>
      </summary>
      <Show when={open()}>
        <div class="border-t">
          <div class="sticky top-[41px] z-10 flex items-center gap-1 border-b bg-card px-2 py-1.5">
            <Button size="sm" variant={compare() ? "ghost" : "secondary"} class="h-7 px-2 text-xs"
              aria-pressed={compare() ? "false" : "true"} onClick={() => setCompare(false)}>
              <Rows3 class="size-3.5" />{text("unified_a1108b48")}
            </Button>
            <Button size="sm" variant={compare() ? "secondary" : "ghost"} class="h-7 px-2 text-xs"
              aria-pressed={compare() ? "true" : "false"} disabled={!wide()} onClick={() => setCompare(true)}
              title={wide() ? text("side_by_side_872790ee") : text("expand_the_panel_to_compare_side_by_side_e4c4ced4")}>
              <Columns2 class="size-3.5" />{text("compare_e182fb40")}
            </Button>
            <div class="flex-1" />
            <Button size="sm" variant={wrapLines() ? "secondary" : "ghost"} class="h-7 px-2 text-xs"
              aria-pressed={wrapLines() ? "true" : "false"} onClick={() => setWrapLines((value) => !value)}>
              <WrapText class="size-3.5" />{text("wrap_bd609a8e")}
            </Button>
          </div>
          <div class="divide-y">
            <For each={props.group.changes} keyed={(change) => change.id}>{(change, index) => (
              <section aria-label={text("change_1d9f6496", { v0: path(), v1: index() + 1 })}>
                <Show when={props.group.changes.length > 1 || change().source}>
                  <div class="flex items-center gap-2 bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">
                    <Show when={props.group.changes.length > 1}>
                      <span>{index() + 1} / {props.group.changes.length}</span>
                      <span>{change().payload.operation}</span>
                    </Show>
                    <Show when={change().source}>
                      {(source) => <span class="min-w-0 truncate">{text("review_subagent_change_source", { title: source().title })}</span>}
                    </Show>
                  </div>
                </Show>
                <DiffBody value={change().payload.diff.unified} path={path()} wrap={wrapLines()} split={compare()} />
              </section>
            )}</For>
          </div>
        </div>
      </Show>
    </details>
  )
}

export function ReviewPane(props: {
  sessionId: string | null
  groups: readonly SessionFileChangeGroup[]
  targetFile?: string | null
  workspace?: string | null
  historyStatus?: string
  status?: JSX.Element
}) {
  const text = createUiText()
  const summary = createMemo(() => summarizeSessionFileChangeGroups(props.groups))
  const selectedId = () => props.groups.find((group) => group.id === props.targetFile || group.filePath === props.targetFile)?.id
  return (
    <Show when={props.sessionId} fallback={
      <div class="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {text("open_a_session_to_view_changes_7de76304")}
      </div>
    }>
      <Show when={props.groups.length} fallback={
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
          <FileDiff class="size-6 opacity-60" />
          {props.status}
          {props.historyStatus || text("this_session_has_no_file_changes_to_review_yet_062e5342")}
        </div>
      }>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="mb-3 flex items-center gap-2 text-sm font-medium">
            <FileDiff class="size-4 text-muted-foreground" />
            <span>{text("file_changes_4d016b2f")}</span>
            <span class="text-xs font-normal text-muted-foreground">
              {text("count_files", { count: summary().fileCount })} · {text("count_changes", { count: summary().editCount })}
            </span>
            <span class="ml-auto shrink-0 text-xs font-normal">
              <span class="text-green-600 dark:text-green-400">+{summary().addedLines}</span>{" "}
              <span class="text-red-600 dark:text-red-400">−{summary().removedLines}</span>
            </span>
          </div>
          <Show when={props.historyStatus}>
            <p role="status" class="mb-3 text-xs text-muted-foreground">{props.historyStatus}</p>
          </Show>
          {props.status}
          <div class="space-y-3">
            <For each={props.groups} keyed={(group) => group.id}>{(group, index) => (
              <FileChanges group={group()} workspace={props.workspace ?? undefined}
                initialOpen={selectedId() ? selectedId() === group().id : index() === props.groups.length - 1}
                selected={selectedId() === group().id} />
            )}</For>
          </div>
        </div>
      </Show>
    </Show>
  )
}
