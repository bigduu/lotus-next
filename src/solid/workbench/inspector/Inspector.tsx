import { createEffect, createMemo, createSignal, Errored, For, lazy, Loading, Show, untrack } from "solid-js"
import { ArrowRight, Copy, FileDiff, FolderGit2, X } from "@lucide/solid"
import { appStore, selectCurrentChat } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { cn } from "@/lib/utils"
import { isDefaultSupervisor } from "@/lib/supervisor"
import { collectSessionFileChanges, groupSessionFileChanges, summarizeSessionFileChangeGroups, type SessionFileChangeGroup } from "@/lib/sessionFileChanges"
import { displayFileChangePath } from "@/components/chat/fileChangePresentation"

import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Button } from "../../ui/button"
import { ActorSnapshotPanel } from "./ActorSnapshotPanel"
import { createManagedNavigation } from "./createManagedNavigation"
import { GoalSection } from "./GoalSection"
import { ContextUsageDetails, InspectorRow, PrefixCacheDetails } from "./UsageDetails"

export interface InspectorProps {
  sessionId: string | null
  open: boolean
  onClose?: () => void
  workspace?: string | null
  fileChangeGroups?: readonly SessionFileChangeGroup[]
  historyStatus?: string | null
  onEditWorkspace?: () => void
  onOpenReview?: (fileId?: string) => void
  onCopySessionId: (sessionId: string) => void
  onSelectActor?: (actorId: string) => void
  selectedActorId?: string | null
}

const taskStatus: Record<string, { icon: string; class: string }> = {
  pending: { icon: "○", class: "text-muted-foreground" },
  in_progress: { icon: "◐", class: "text-primary" },
  completed: { icon: "✓", class: "text-emerald-500" },
  skipped: { icon: "–", class: "text-muted-foreground" },
  failed: { icon: "✗", class: "text-destructive" },
}

export function Inspector(props: InspectorProps) {
  return <Show when={props.open}><InspectorContent {...props} /></Show>
}

function InspectorContent(props: InspectorProps) {
  const text = createUiText()
  const sessionId = () => props.sessionId
  const byId = createStoreSelector(appStore, (state) => state.chats)
  const currentChat = createStoreSelector(appStore, selectCurrentChat)
  const chat = createMemo(() => {
    const id = sessionId()
    return id ? byId().find((item) => item.id === id) : currentChat()
  })
  const config = () => chat()?.config
  const rootId = () => chat()?.kind === "root" ? chat()!.id : chat()?.rootSessionId ?? null
  const descendants = createMemo(() => byId().find((item) => item.id === rootId())?.subagentCount ?? null)
  const liveUsage = createStoreSelector(appStore, (state) => state.tokenUsages)
  const taskLists = createStoreSelector(appStore, (state) => state.taskLists)
  const evaluations = createStoreSelector(appStore, (state) => state.evaluationStates)
  const usage = () => (sessionId() ? liveUsage()[sessionId()!] : undefined) ?? config()?.tokenUsage
  const taskList = () => sessionId() ? taskLists()[sessionId()!] : undefined
  const evaluation = () => sessionId() ? evaluations()[sessionId()!] : undefined
  const providerState = createStoreSelector(providerStore, (state) => state)
  const provider = createMemo(() => {
    const id = config()?.model_ref?.provider
    return id ? providerState().getProviderDisplayLabel(id) : null
  })
  const isSupervisor = () => { const selected = chat(); return selected && isDefaultSupervisor(selected) }
  const groups = createMemo(() => props.fileChangeGroups ?? groupSessionFileChanges(
    collectSessionFileChanges(sessionId() ? chat()?.messages ?? [] : []), props.workspace ?? undefined,
  ))
  const fileSummary = createMemo(() => summarizeSessionFileChangeGroups(groups()))
  const canReviewSubagents = () => Boolean(props.onOpenReview && chat()?.kind === "root" && descendants())
  createEffect(sessionId, (id) => { if (id && props.open) void appStore.getState().loadTaskList(id).catch(() => {}) })

  const Actors = (input: { active: boolean }) => <ActorSnapshotPanel rootId={rootId()} active={input.active && props.open}
    selectedActorId={props.selectedActorId ?? sessionId()} descendantCountHint={descendants()} onSelectActor={(id) => props.onSelectActor?.(id)} />
  return <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-inspector>
    <Show when={props.onClose}>
      <div class="flex items-center justify-between border-b px-4 py-3">
        <span class="text-sm font-semibold">{text("inspector_fc48a7f2")}</span>
        <Button size="icon" variant="ghost" aria-label={text("close_inspector_ac416b66")} onClick={() => props.onClose?.()}><X /></Button>
      </div>
    </Show>
    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <Show when={isSupervisor() && sessionId()} keyed fallback={<Actors active />}>
        {(id) => <SupervisorExtras active={props.open && sessionId() === id && Boolean(isSupervisor())} actors={Actors} />}
      </Show>
      <section class="rounded-lg border p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-muted-foreground">{text("working_directory_3db7b06b")}</span>
          <Show when={props.onEditWorkspace}>
            <button type="button" onClick={() => props.onEditWorkspace?.()} class="text-xs text-primary hover:underline">
              {text(sessionId() ? "change_6b01fce4" : "select_c11330b8")}
            </button>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <FolderGit2 class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate font-mono text-xs" title={props.workspace || undefined}>{props.workspace || text("default_directory_4ff28651")}</span>
        </div>
        <Show when={sessionId()}><p class="mt-1.5 text-[11px] text-muted-foreground">{text("set_when_the_session_is_created_changes_apply_to_new_se_33699fd8")}</p></Show>
      </section>
      <Show when={sessionId()} keyed>{(id) => <GoalSection sessionId={id} goldConfig={config()?.goldConfig} goalState={config()?.goalState} />}</Show>
      <section class="rounded-lg border p-3">
        <div class="mb-2 text-xs font-medium text-muted-foreground">{text("task_list_a4ea7d95")}</div>
        <Show when={evaluation()?.isEvaluating} fallback={
          <Show when={evaluation()?.reasoning}><p class="mb-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">{evaluation()?.reasoning}</p></Show>
        }><p class="mb-2 flex items-center gap-1.5 text-xs text-primary"><span class="size-1.5 animate-pulse rounded-full bg-primary" />{text("evaluating_task_progress_602a2eb0")}</p></Show>
        <Show when={taskList()?.items.length} fallback={<p class="text-xs text-muted-foreground">{text("no_tasks_yet_da968898")}</p>}>
          <ul class="space-y-1.5"><For each={taskList()?.items ?? []} keyed={(task) => task.id}>{(task) => {
            const status = () => taskStatus[task().status] ?? taskStatus.pending
            return <li class="flex gap-2 text-sm">
              <span class={cn("mt-0.5 shrink-0", status().class)}>{status().icon}</span>
              <span class={cn("leading-relaxed", task().status === "completed" && "text-muted-foreground line-through")}>{task().description}</span>
            </li>
          }}</For></ul>
        </Show>
      </section>
      <Show when={props.historyStatus || groups().length || canReviewSubagents()}>
        <section class="rounded-lg border p-3">
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-muted-foreground">{text("file_changes_4d016b2f")}</span>
            <Show when={props.onOpenReview}>
              <button type="button" onClick={() => props.onOpenReview?.()} class="flex items-center gap-0.5 text-xs text-primary hover:underline">Review<ArrowRight class="size-3" /></button>
            </Show>
          </div>
          <Show when={props.historyStatus}><p role="status" class="text-xs text-muted-foreground">{props.historyStatus}</p></Show>
          <Show when={groups().length}>
            <div class="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>{text("count_files", { count: fileSummary().fileCount })} · {text("count_changes", { count: fileSummary().editCount })}</span>
              <ChangeCounts added={fileSummary().addedLines} removed={fileSummary().removedLines} />
            </div>
            <div class="space-y-0.5"><For each={groups()} keyed={(group) => group.id}>{(group) => {
              const name = () => displayFileChangePath(group().filePath, "basename", props.workspace ?? undefined)
              return <button type="button" class="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs hover:bg-accent"
                onClick={() => props.onOpenReview?.(group().id)} title={text("view_in_review_93af0688", { v0: name() })}>
                <FileDiff class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate font-mono" title={group().filePath}>{name()}</span>
                <Show when={group().changes.length > 1}>
                  <span class="shrink-0 text-[10px] text-muted-foreground">{text("count_changes", { count: group().changes.length })}</span>
                </Show>
                <ChangeCounts added={group().addedLines} removed={group().removedLines} />
              </button>
            }}</For></div>
          </Show>
        </section>
      </Show>
      <details class="rounded-lg border p-3">
        <summary class="cursor-pointer select-none text-xs font-medium text-muted-foreground">{text("advanced_details_d305be8b")}</summary>
        <div class="mt-3 space-y-3">
          <div>
            <div class="mb-1 text-xs text-muted-foreground">{text("config_148d195e")}</div>
            <Show when={sessionId()}>{(id) => <div class="flex items-start justify-between gap-3 py-0.5 text-sm">
              <span class="shrink-0 text-muted-foreground">{text("session_id_a76bd2d8")}</span>
              <div class="flex min-w-0 items-start gap-1">
                <code class="break-all text-right font-mono text-xs select-text" title={id()}>{id()}</code>
                <button type="button" aria-label={text("copy_session_id_7df96a6b")} title={text("copy_session_id_7df96a6b")}
                  onClick={() => props.onCopySessionId(id())} class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Copy class="size-3.5" /></button>
              </div>
            </div>}</Show>
            <InspectorRow label={text("model_c98e118e")} value={config()?.model_ref?.model || config()?.model || "—"} />
            <Show when={provider()}>{(label) => <InspectorRow label={text("provider_9e218722")} value={label()} />}</Show>
            <Show when={config()?.reasoningEffort}>{(level) => <InspectorRow label={text("reasoning_level_c8c14507")} value={level()} />}</Show>
          </div>
          <Show when={usage()}>{(tokens) => <ContextUsageDetails usage={tokens()} />}</Show>
          <PrefixCacheDetails usage={usage()} />
        </div>
      </details>
    </div>
  </div>
}

function ChangeCounts(props: { added: number; removed: number }) {
  return <span class="shrink-0 text-[11px]"><span class="text-green-600 dark:text-green-400">+{props.added}</span>{" "}
    <span class="text-red-600 dark:text-red-400">−{props.removed}</span></span>
}

function SupervisorExtras(props: { active: boolean; actors: (input: { active: boolean }) => ReturnType<typeof ActorSnapshotPanel> }) {
  const text = createUiText()
  const [auxiliaryOpen, setAuxiliaryOpen] = createSignal(false)
  const [attempt, setAttempt] = createSignal(1)
  const openSession = createManagedNavigation(() => props.active)
  const Actors = untrack(() => props.actors)
  return <>
    <Show when={attempt()} keyed>{(_attempt) => {
      const Panel = lazy(() => import("./SupervisorManagedSessions"), { export: "SupervisorManagedSessionsPanel" })
      return <Errored fallback={() => <div role="alert" class="text-sm">
        <p>{text("supervisor_sessions_render_failed")}</p>
        <button type="button" class="mt-2 underline" onClick={() => setAttempt((value) => value + 1)}>{text("retry_b8784c8d")}</button>
      </div>}><Loading fallback={<p role="status" class="text-xs text-muted-foreground">{text("supervisor_sessions_loading")}</p>}>
        <Panel active={props.active} onSelectSession={openSession} />
      </Loading></Errored>
    }}</Show>
    <details class="rounded-lg border p-3" onToggle={(event) => setAuxiliaryOpen(event.currentTarget.open)} data-testid="supervisor-auxiliary-agents">
      <summary class="cursor-pointer text-xs font-medium text-muted-foreground">{text("supervisor_sessions_auxiliary")}</summary>
      <div class="mt-3"><Actors active={auxiliaryOpen() && props.active} /></div>
    </details>
  </>
}
