import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useId, useRef, type Ref, type ReactNode } from "react"
import {
  X,
  Paperclip,
  FolderGit2,
  FolderClosed,
  ChevronDown,
  ArrowUp,
  Square,
  BookText,
  Check,
  LoaderCircle,
  Clock3,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SlashMenu } from "@/components/chat/SlashMenu"
import { FileMenu } from "@/components/chat/FileMenu"
import { useAppStore } from "@shared/store/appStore"
import type { SkillDefinition } from "@shared/types/skill"
import type { WorkflowCatalogEntry } from "@services/command/workflowCatalog"
import type { WorkflowCatalogState } from "@/components/chat/useWorkflowCatalog"
import type { CommandItem } from "@services/command"
import type { GuidanceMode } from "@services/chat/guidance"
import type { WorkspaceFileEntry } from "@services/workspace/types"

/**
 * Base system-prompt preset chip for NEW chats: the selected preset's content
 * is sent as `system_prompt` on the first message (useChat.send reads
 * lastSelectedPromptId). A picked task template is appended to, rather than
 * substituted for, this base prompt. Hidden when the user has no presets.
 */
function PromptChip() {
  useUiLocale()
  const systemPrompts = useAppStore(useShallow((s) => s.systemPrompts))
  const lastSelectedPromptId = useAppStore((s) => s.lastSelectedPromptId)
  const setLastSelectedPromptId = useAppStore((s) => s.setLastSelectedPromptId)
  if (systemPrompts.length === 0) return null
  const active = systemPrompts.find((p) => p.id === lastSelectedPromptId)
    ?? systemPrompts.find((p) => p.isDefault)
    ?? systemPrompts[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          title={uiText("system_prompt_b9068145", { v0: active.name })}
        >
          <BookText className="size-3.5 shrink-0" />
          <span className="truncate">{active.name}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {systemPrompts.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => setLastSelectedPromptId(p.id)}>
            {active?.id === p.id ? <Check className="size-3.5" /> : <span className="size-3.5" />}
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Project chip for NEW chats: picking a Project pins the next session to it
 * (project_id on first send) and the workspace follows the Project's primary
 * path. Selecting a Project clears a manually-picked workspace and vice versa.
 */
function ProjectChip({
  selectedProjectId,
  onSelect,
}: {
  selectedProjectId: string | null
  onSelect: (projectId: string | null) => void
}) {
  useUiLocale()
  const projects = useAppStore(useShallow((s) => s.projects))
  const projectsAvailable = useAppStore((s) => s.projectsAvailable)
  if (projectsAvailable === false) return null
  const active = Object.values(projects)
    .filter((p) => p.status === "active" && p.project_path_status === "configured")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const selected = selectedProjectId ? projects[selectedProjectId] : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          title={selected ? uiText("project_690aa0ce", { v0: selected.name }) : uiText("select_project_682279bf")}
        >
          <FolderClosed className="size-3.5 shrink-0" />
          <span className="truncate">{selected ? selected.name : uiText("select_project_682279bf")}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onSelect(null)}>
          {!selected ? <Check className="size-3.5" /> : <span className="size-3.5" />}
          {uiText("no_project_4fdaa950")}</DropdownMenuItem>
        {active.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onSelect(p.id)}>
            {selected?.id === p.id ? <Check className="size-3.5" /> : <span className="size-3.5" />}
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type AttachmentView = { id: string; url: string; name: string }

export function Composer({
  draft,
  outputRate,
  onDraftChange,
  onSubmit,
  onStop,
  sending,
  queueMode,
  onQueueModeChange,
  queueControls,
  permissionControl,
  runtimeControls,
  workflowControl,
  workflowUndoControl,
  catalogState,
  onPickCatalogEntry,
  catalogDisabled,
  submissionPending,
  inputRef,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onPreviewImage,
  selectedSkill,
  onClearSkill,
  onPickSkill,
  skills,
  workflows,
  selectedWorkflow,
  onClearWorkflow,
  onPickWorkflow,
  onPickCatalog,
  onOpenCatalog,
  onPickGoal,
  slashQuery,
  atQuery,
  displayWorkspace,
  workspaceFiles,
  onPickFile,
  hasSession,
  onOpenWorkspacePicker,
  selectedProjectId,
  onSelectProject,
  onDismissMenus,
}: {
  draft: string
  /** Estimated streaming output speed; absent when the current run has no rate. */
  outputRate?: number | null
  onDraftChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  sending: boolean
  queueMode?: GuidanceMode
  onQueueModeChange?: (mode: GuidanceMode) => void
  queueControls?: ReactNode
  /** Permission selector shown in the lower-left composer toolbar. */
  permissionControl?: ReactNode
  /** Context, reasoning, and model controls shown in the lower-right toolbar. */
  runtimeControls?: ReactNode
  /** Exact catalog selection; separate from slash-command text expansion. */
  workflowControl?: ReactNode
  workflowUndoControl?: ReactNode
  catalogState?: WorkflowCatalogState
  onPickCatalogEntry?: (entry: WorkflowCatalogEntry) => void
  catalogDisabled?: boolean
  submissionPending: boolean
  inputRef: Ref<HTMLTextAreaElement>
  attachments: AttachmentView[]
  onAddFiles: (files: FileList | File[]) => void
  onRemoveAttachment: (id: string) => void
  onPreviewImage: (src: string) => void
  selectedSkill: SkillDefinition | null
  onClearSkill: () => void
  onPickSkill: (skill: SkillDefinition) => void
  skills: SkillDefinition[]
  workflows: CommandItem[]
  selectedWorkflow: { name: string; content: string } | null
  onClearWorkflow: () => void
  onPickWorkflow: (command: CommandItem) => void
  onPickCatalog?: () => void
  onOpenCatalog?: () => void
  onPickGoal?: () => void
  slashQuery: string | null
  atQuery: string | null
  displayWorkspace: string | null | undefined
  workspaceFiles: WorkspaceFileEntry[]
  onPickFile: (entry: WorkspaceFileEntry) => void
  hasSession: boolean
  onOpenWorkspacePicker: () => void
  /** Project pinned for the next NEW session (composer chip). */
  selectedProjectId: string | null
  onSelectProject: (projectId: string | null) => void
  onDismissMenus?: () => void
}) {
  useUiLocale()
  const inputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canQueue = sending && !!onQueueModeChange
  const hasContent = !!draft.trim() || attachments.length > 0 || !!selectedWorkflow

  return (
    <div className="shrink-0 border-t px-3 py-3">
      {queueControls}
      {slashQuery !== null && (
        <SlashMenu
          inputId={inputId}
          catalogState={catalogState}
          onPickCatalogEntry={onPickCatalogEntry}
          catalogDisabled={catalogDisabled}
          skills={skills}
          workflows={workflows}
          query={slashQuery}
          onPick={onPickSkill}
          onPickWorkflow={onPickWorkflow}
          onPickCatalog={onPickCatalog}
          onPickGoal={onPickGoal}
          onDismiss={onDismissMenus}
        />
      )}
      {slashQuery === null && atQuery !== null && displayWorkspace ? (
        <FileMenu inputId={inputId} files={workspaceFiles} query={atQuery} onPick={onPickFile} onDismiss={onDismissMenus} />
      ) : null}
      {selectedSkill && (
        <div className="mx-auto mb-2 flex w-full max-w-6xl">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
            /{selectedSkill.name}
            <button
              onClick={onClearSkill}
              aria-label={uiText("remove_skill_1324d3de")}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      )}
      {selectedWorkflow && (
        <div className="mx-auto mb-2 flex w-full max-w-6xl">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
            {uiText("text_expansion_6768e498")}{selectedWorkflow.name}
            <button
              onClick={onClearWorkflow}
              aria-label={uiText("remove_workflow_c1c0133d")}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mx-auto mb-2 flex w-full max-w-6xl flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="relative size-24 overflow-hidden rounded-2xl border">
              <img
                src={a.url}
                alt={a.name}
                className="size-full cursor-zoom-in object-cover transition-opacity hover:opacity-90"
                onClick={() => onPreviewImage(a.url)}
              />
              <button
                onClick={() => onRemoveAttachment(a.id)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
                aria-label={uiText("remove_image_86d72aab")}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onAddFiles(e.target.files)
          e.target.value = ""
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl">
        <div
          data-composer-surface
          className="rounded-2xl border bg-card p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring/40"
        >
          {workflowControl}
          {workflowUndoControl}
          <div className="relative">
            <Textarea
              id={inputId}
              ref={inputRef}
              value={draft}
              aria-label={uiText("messages_4da199fa")}
              aria-busy={submissionPending}
              onChange={(e) => onDraftChange(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length) {
                  // Stop the browser from also pasting the file path as text
                  // (e.g. CleanShot dumps the screenshot path into the box).
                  e.preventDefault()
                  onAddFiles(files)
                }
              }}
              onKeyDown={(e) => {
                const nativeEvent = e.nativeEvent
                if (e.defaultPrevented || nativeEvent.isComposing || nativeEvent.keyCode === 229) return
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (!submissionPending && hasContent && (!sending || canQueue)) onSubmit()
                }
              }}
              title={uiText("enter_to_send_shift_enter_for_a_new_line_b6153e81")}
              placeholder={canQueue ? uiText("type_a_message_to_add_to_the_queue_38c6f67b") : uiText("send_a_message_ae2f86f0")}
              rows={1}
              style={{ paddingRight: 128 }}
              className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {typeof outputRate === "number" && (
              <span
                data-output-rate
                className="absolute right-2 top-2 text-xs tabular-nums text-muted-foreground"
                style={{ maxWidth: 112, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={uiText("estimated_from_streamed_text_not_used_for_billing_1de5fc8d")}
              >
                {uiText("output_rate", { rate: outputRate.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-1.5">
            <div className="flex min-w-0 basis-full flex-wrap items-center gap-1 sm:basis-auto sm:flex-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground"
                aria-label={uiText("add_images_9f0d4e46")}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              {onPickCatalog && <Button size="icon" variant="ghost" className="size-8 shrink-0 text-muted-foreground"
                aria-label={uiText("open_workflow_catalog_1bd98d37")} title={uiText("catalog_workflow_this_message_4bad8776")} onClick={onOpenCatalog ?? onPickCatalog}><BookText className="size-4" /></Button>}
              {permissionControl}
              {!hasSession ? (
                <>
                  <ProjectChip
                    selectedProjectId={selectedProjectId}
                    onSelect={onSelectProject}
                  />
                  <button
                    onClick={onOpenWorkspacePicker}
                    className={selectedProjectId ? "hidden" : "flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"}
                    title={displayWorkspace || uiText("default_working_directory_3d80c40d")}
                  >
                    <FolderGit2 className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {displayWorkspace
                        ? displayWorkspace.split("/").filter(Boolean).pop() || displayWorkspace
                        : uiText("select_working_directory_18240aa3")}
                    </span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                  </button>
                  <PromptChip />
                </>
              ) : null}
            </div>
            <div className="ml-auto flex w-full max-w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
              {canQueue ? (
                <div className="relative h-8 w-8 shrink-0 sm:w-24">
                  <Clock3 aria-hidden="true" className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground sm:hidden" />
                  <select aria-label={uiText("send_timing_22388dde")} value={queueMode ?? "after_round"} disabled={submissionPending}
                    onChange={(event) => onQueueModeChange?.(event.target.value as GuidanceMode)}
                    title={queueMode === "after_run" ? uiText("send_when_the_run_finishes_1525b79a") : uiText("send_after_the_current_tool_call_before_the_next_model__ce3a9c75")}
                    className="h-full w-full appearance-none rounded border-0 bg-transparent text-xs text-transparent sm:appearance-auto sm:text-foreground">
                    <option className="text-foreground" value="after_round">{uiText("after_tool_call_252b019e")}</option>
                    <option className="text-foreground" value="after_run">{uiText("after_run_81638e07")}</option>
                  </select>
                </div>
              ) : null}
              {runtimeControls}
              {submissionPending ? (
                <Button size="icon" disabled aria-label={uiText("sending_2d88d503")} className="rounded-full">
                  <LoaderCircle className="animate-spin" />
                </Button>
              ) : (!sending || (canQueue && hasContent)) ? (
                <Button size="icon" onClick={onSubmit} disabled={!hasContent} className="rounded-full"
                  aria-label={canQueue ? uiText("add_to_queue_bc3b684c") : uiText("send_message_00881483")} title={canQueue ? uiText("add_to_queue_bc3b684c") : uiText("send_message_00881483")}><ArrowUp /></Button>
              ) : null}
              {sending && (!submissionPending || canQueue) ? (
                <Button size="icon" onClick={onStop} className="rounded-full" aria-label={uiText("stop_generation_9ad0aac3")}>
                  <Square fill="white" stroke="white" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
