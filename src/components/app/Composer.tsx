import { uiText, useUiLocale, uiLanguage } from "@shared/i18n/ui"
import { lazy, Suspense, useId, useRef, useState, useEffect, type Ref, type ReactNode } from "react"
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
  Ellipsis,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import type { ComposerInputHandle, ComposerFocusSnapshot, FileSuggestion } from "@/components/chat/ComposerEditor"
import { composerControlClassName, composerIconButtonClassName } from "@/components/chat/composerStyles"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { SlashMenu } from "@/components/chat/SlashMenu"
import { FileMenu } from "@/components/chat/FileMenu"
import { useAppStore } from "@shared/store/appStore"
import type { SkillDefinition } from "@shared/types/skill"
import type { WorkflowCatalogEntry } from "@services/command/workflowCatalog"
import type { WorkflowCatalogState } from "@/components/chat/useWorkflowCatalog"
import type { CommandItem } from "@services/command"
import type { GuidanceMode } from "@services/chat/guidance"
import type { WorkspaceFileEntry } from "@services/workspace/types"

// The Tiptap editor graph is startup-expensive; keep it behind a dynamic
// feature entry like Settings/Markdown. Types erase at compile time.
const ComposerEditor = lazy(() =>
  import("@/components/chat/ComposerEditor").then((module) => ({ default: module.ComposerEditor })),
)

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
          className={composerControlClassName}
          title={uiText("system_prompt_b9068145", { v0: active.name })}
        >
          <BookText className="size-4 shrink-0" />
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
          className={composerControlClassName}
          title={selected ? uiText("project_690aa0ce", { v0: selected.name }) : uiText("select_project_682279bf")}
        >
          <FolderClosed className="size-4 shrink-0" />
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
  draftKey,
  contentShiftX = 0,
  outputRate,
  onDraftChange,
  onSubmit,
  executionBlocked = false,
  onStop,
  sending,
  queueMode,
  onQueueModeChange,
  sendWhileRunning = false,
  queueControls,
  permissionControl,
  workspaceControl,
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
  onMentionQueryChange,
  displayWorkspace,
  showProjectWorkspace = false,
  workspaceFiles,
  hasSession,
  onOpenWorkspacePicker,
  selectedProjectId,
  onSelectProject,
  onDismissMenus,
}: {
  draft: string
  draftKey?: string
  /** Keep the entire input column aligned with the transcript beside Environment. */
  contentShiftX?: number
  /** Estimated streaming output speed; absent when the current run has no rate. */
  outputRate?: number | null
  onDraftChange: (v: string) => void
  onSubmit: () => void
  executionBlocked?: boolean
  onStop: () => void
  sending: boolean
  queueMode?: GuidanceMode
  onQueueModeChange?: (mode: GuidanceMode) => void
  sendWhileRunning?: boolean
  queueControls?: ReactNode
  /** Permission selector shown in the lower-left composer toolbar. */
  permissionControl?: ReactNode
  /** Draft workspace/worktree selector beside Project, shown only for new chats. */
  workspaceControl?: ReactNode
  /** Context, reasoning, and model controls shown in the lower-right toolbar. */
  runtimeControls?: ReactNode
  /** Exact catalog selection; separate from slash-command text expansion. */
  workflowControl?: ReactNode
  workflowUndoControl?: ReactNode
  catalogState?: WorkflowCatalogState
  onPickCatalogEntry?: (entry: WorkflowCatalogEntry) => void
  catalogDisabled?: boolean
  submissionPending: boolean
  inputRef: Ref<ComposerInputHandle>
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
  onMentionQueryChange: (query: string | null) => void
  displayWorkspace: string | null | undefined
  /** Keep an explicitly selected worktree visible beside its Project. */
  showProjectWorkspace?: boolean
  workspaceFiles: WorkspaceFileEntry[]
  hasSession: boolean
  onOpenWorkspacePicker: () => void
  /** Project pinned for the next NEW session (composer chip). */
  selectedProjectId: string | null
  onSelectProject: (projectId: string | null) => void
  onDismissMenus?: () => void
}) {
  useUiLocale()
  const inputId = useId()
  const [columnRef, columnWidth] = useContainerWidth<HTMLDivElement>()
  const compactToolbar = columnWidth > 0 && columnWidth < 600
  const compactToolbarRef = useRef(compactToolbar)
  compactToolbarRef.current = compactToolbar
  const [moreOpen, setMoreOpen] = useState(false)
  const openingExternalControl = useRef(false)
  useEffect(() => { setMoreOpen(false) }, [compactToolbar, draftKey])

  const focusSnapshot = useRef<ComposerFocusSnapshot>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileSuggestion, setFileSuggestion] = useState<FileSuggestion | null>(null)
  const mentionQuery = fileSuggestion?.query ?? null
  useEffect(() => onMentionQueryChange(mentionQuery), [mentionQuery, onMentionQueryChange])
  useEffect(() => setFileSuggestion(null), [draftKey, displayWorkspace])
  const canQueue = sending && !!onQueueModeChange
  const canSubmit = !sending || canQueue || sendWhileRunning
  const hasContent = !!draft.trim() || attachments.length > 0 || !!selectedWorkflow

  const openSecondaryDialog = (open: () => void) => {
    if (moreOpen) {
      openingExternalControl.current = true
      setMoreOpen(false)
    }
    open()
  }
  const secondaryControls = (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1" data-composer-secondary-controls>
      <Button
        size="icon"
        variant="ghost"
        className={composerIconButtonClassName}
        aria-label={uiText("add_images_9f0d4e46")}
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip className="size-4" />
      </Button>
      {onPickCatalog && <Button size="icon" variant="ghost" className={composerIconButtonClassName}
        aria-label={uiText("open_workflow_catalog_1bd98d37")} title={uiText("catalog_workflow_this_message_4bad8776")} onClick={() => openSecondaryDialog(onOpenCatalog ?? onPickCatalog)}><BookText className="size-4" /></Button>}
      {!hasSession ? (
        <>
          <ProjectChip
            selectedProjectId={selectedProjectId}
            onSelect={onSelectProject}
          />
          {workspaceControl}
          <button
            onClick={() => openSecondaryDialog(onOpenWorkspacePicker)}
            className={selectedProjectId && !showProjectWorkspace ? "hidden" : composerControlClassName}
            title={displayWorkspace || uiText("default_working_directory_3d80c40d")}
          >
            <FolderGit2 className="size-4 shrink-0" />
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
  )

  return (
    <div className="min-w-0 shrink-0 px-3 py-3">
      <div
        ref={columnRef}
        data-composer-column
        data-composer-compact={compactToolbar}
        className="relative mx-auto min-w-0 w-full max-w-full"
        style={{ transform: `translateX(${contentShiftX}px)`, transition: "transform var(--motion-normal) var(--motion-ease)" }}
      >
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
      {slashQuery === null && fileSuggestion && displayWorkspace ? (
        <FileMenu inputId={inputId} files={workspaceFiles} query={fileSuggestion.query}
          onPick={(entry) => fileSuggestion.pick(entry.path)} onDismiss={() => fileSuggestion.dismiss()} />
      ) : null}
      {selectedSkill && (
        <div className="mx-auto mb-2 flex w-full max-w-full">
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
        <div className="mx-auto mb-2 flex w-full max-w-full">
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
        <div className="mx-auto mb-2 flex w-full max-w-full flex-wrap gap-2">
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
      <div className="relative mx-auto min-w-0 w-full max-w-full">
        <div
          data-composer-surface
          className="rounded-2xl border border-transparent bg-card p-1.5"
          style={{ borderRadius: "1.5rem" }}
        >
          {workflowControl}
          {workflowUndoControl}
          <div className="relative">
            <Suspense
              fallback={
                <div
                  data-composer-editor=""
                  aria-hidden="true"
                  className="min-h-11 w-full px-2 py-2 text-base"
                />
              }
            >
              <ComposerEditor
              key={draftKey}
              id={inputId}
              inputRef={inputRef}
              focusSnapshot={focusSnapshot}
              value={draft}
              label={uiText("messages_4da199fa")}
              busy={submissionPending}
              onChange={onDraftChange}
              onAddFiles={onAddFiles}
              onSubmit={() => { if (!executionBlocked && !submissionPending && hasContent && canSubmit) onSubmit() }}
              mentionScope={displayWorkspace}
              mentionsEnabled={slashQuery === null && !!displayWorkspace}
              onSuggestionChange={setFileSuggestion}
              title={uiText("enter_to_send_shift_enter_for_a_new_line_b6153e81")}
              placeholder={canQueue ? uiText("type_a_message_to_add_to_the_queue_38c6f67b") : uiText("send_a_message_ae2f86f0")}
            />
            </Suspense>
          </div>
          <div data-composer-toolbar className="flex flex-wrap items-center gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1"
              style={{ flex: compactToolbar ? "1 0 100%" : "1 1 auto" }}>
              {permissionControl}
              {compactToolbar ? (
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger asChild>
                    <Button size="icon" variant="ghost" className={composerIconButtonClassName}
                      aria-label={uiText("more_38844b13")} title={uiText("more_38844b13")}>
                      <Ellipsis className="size-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" aria-label={uiText("more_38844b13")}
                    style={{ maxWidth: "calc(100vw - 24px)" }}
                    onCloseAutoFocus={(event) => {
                      if (openingExternalControl.current) {
                        openingExternalControl.current = false
                        event.preventDefault()
                      } else if (!compactToolbarRef.current) {
                        event.preventDefault()
                        columnRef.current?.querySelector<HTMLElement>("[data-composer-editor]")?.focus()
                      }
                    }}>
                    {secondaryControls}
                  </PopoverContent>
                </Popover>
              ) : secondaryControls}
              {typeof outputRate === "number" && (
                <span data-output-rate className="ml-auto min-w-0 text-xs tabular-nums text-muted-foreground"
                  style={{ maxWidth: 112, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={uiText("estimated_from_streamed_text_not_used_for_billing_1de5fc8d")}>
                  {uiText("output_rate", { rate: outputRate.toLocaleString(uiLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
                </span>
              )}
            </div>
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
              {canQueue ? (
                <div className="relative h-8 shrink-0" style={{ width: compactToolbar ? 32 : 96 }}>
                  <Clock3 aria-hidden="true" className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" style={{ display: compactToolbar ? undefined : "none" }} />
                  <select aria-label={uiText("send_timing_22388dde")} value={queueMode ?? "after_round"} disabled={submissionPending}
                    onChange={(event) => onQueueModeChange?.(event.target.value as GuidanceMode)}
                    title={queueMode === "after_run" ? uiText("send_when_the_run_finishes_1525b79a") : uiText("send_after_the_current_tool_call_before_the_next_model__ce3a9c75")}
                    className="h-full w-full rounded-md border-0 bg-transparent text-sm text-muted-foreground"
                    style={{ appearance: compactToolbar ? "none" : "auto", color: compactToolbar ? "transparent" : undefined }}>
                    <option className="text-foreground" value="after_round">{uiText("after_tool_call_252b019e")}</option>
                    <option className="text-foreground" value="after_run">{uiText("after_run_81638e07")}</option>
                  </select>
                </div>
              ) : null}
              {runtimeControls}
              {submissionPending ? (
                <Button size="icon" disabled aria-label={uiText("sending_2d88d503")} className="size-8 rounded-full">
                  <LoaderCircle className="animate-spin" />
                </Button>
              ) : canSubmit ? (
                <Button size="icon" onClick={onSubmit} disabled={!hasContent || executionBlocked} className="size-8 rounded-full"
                  aria-label={canQueue ? uiText("add_to_queue_bc3b684c") : uiText("send_message_00881483")} title={canQueue ? uiText("add_to_queue_bc3b684c") : uiText("send_message_00881483")}><ArrowUp /></Button>
              ) : null}
              {sending && (!submissionPending || canQueue) ? (
                <Button size="icon" onClick={onStop} className="size-8 rounded-full" aria-label={uiText("stop_generation_9ad0aac3")}>
                  <Square fill="currentColor" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
