import { useRef, type Ref, type ReactNode } from "react"
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
import type { CommandItem } from "@services/command"
import type { GuidanceMode } from "@services/chat/guidance"
import type { WorkspaceFileEntry } from "@services/workspace/types"

/**
 * System-prompt preset chip for NEW chats: the selected preset's content is
 * sent as `system_prompt` on the first message (useChat.send reads
 * lastSelectedPromptId). Hidden when the user has no presets.
 */
function PromptChip() {
  const systemPrompts = useAppStore(useShallow((s) => s.systemPrompts))
  const lastSelectedPromptId = useAppStore((s) => s.lastSelectedPromptId)
  const setLastSelectedPromptId = useAppStore((s) => s.setLastSelectedPromptId)
  if (systemPrompts.length === 0) return null
  const active = systemPrompts.find((p) => p.id === lastSelectedPromptId)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          title={active ? `系统提示词:${active.name}` : "选择系统提示词"}
        >
          <BookText className="size-3.5 shrink-0" />
          <span className="truncate">{active ? active.name : "默认提示词"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => setLastSelectedPromptId("")}>
          {!active ? <Check className="size-3.5" /> : <span className="size-3.5" />}
          默认提示词
        </DropdownMenuItem>
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
          title={selected ? `项目:${selected.name}` : "选择项目"}
        >
          <FolderClosed className="size-3.5 shrink-0" />
          <span className="truncate">{selected ? selected.name : "选择项目"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onSelect(null)}>
          {!selected ? <Check className="size-3.5" /> : <span className="size-3.5" />}
          不指定项目
        </DropdownMenuItem>
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
  onDraftChange,
  onSubmit,
  onStop,
  sending,
  queueMode,
  onQueueModeChange,
  queueControls,
  permissionControl,
  runtimeControls,
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canQueue = sending && !!onQueueModeChange
  const hasContent = !!draft.trim() || attachments.length > 0 || !!selectedWorkflow

  return (
    <div className="shrink-0 border-t px-3 py-3">
      {queueControls}
      {slashQuery !== null && (
        <SlashMenu
          skills={skills}
          workflows={workflows}
          query={slashQuery}
          onPick={onPickSkill}
          onPickWorkflow={onPickWorkflow}
          onPickGoal={onPickGoal}
          onDismiss={onDismissMenus}
        />
      )}
      {slashQuery === null && atQuery !== null && displayWorkspace ? (
        <FileMenu files={workspaceFiles} query={atQuery} onPick={onPickFile} onDismiss={onDismissMenus} />
      ) : null}
      {selectedSkill && (
        <div className="mx-auto mb-2 flex w-full max-w-6xl">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
            /{selectedSkill.name}
            <button
              onClick={onClearSkill}
              aria-label="移除技能"
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
            工作流 /{selectedWorkflow.name}
            <button
              onClick={onClearWorkflow}
              aria-label="移除工作流"
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
                aria-label="移除图片"
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
          <Textarea
            ref={inputRef}
            value={draft}
            aria-label="消息"
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
            title="Enter 发送，Shift+Enter 换行"
            placeholder={canQueue ? "输入消息，发送后加入队列…" : "发送消息…"}
            rows={1}
            className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex flex-wrap items-end gap-1.5">
            <div className="flex min-w-0 basis-full flex-wrap items-center gap-1 sm:basis-auto sm:flex-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground"
                aria-label="添加图片"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
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
                    title={displayWorkspace || "默认工作目录"}
                  >
                    <FolderGit2 className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {displayWorkspace
                        ? displayWorkspace.split("/").filter(Boolean).pop() || displayWorkspace
                        : "选择工作目录"}
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
                  <select aria-label="发送时机" value={queueMode ?? "after_round"} disabled={submissionPending}
                    onChange={(event) => onQueueModeChange?.(event.target.value as GuidanceMode)}
                    title={queueMode === "after_run" ? "运行结束后发送" : "本轮结束后发送"}
                    className="h-full w-full appearance-none rounded border-0 bg-transparent text-xs text-transparent sm:appearance-auto sm:text-foreground">
                    <option className="text-foreground" value="after_round">本轮结束后</option>
                    <option className="text-foreground" value="after_run">运行结束后</option>
                  </select>
                </div>
              ) : null}
              {runtimeControls}
              {submissionPending ? (
                <Button size="icon" disabled aria-label="正在发送" className="rounded-full">
                  <LoaderCircle className="animate-spin" />
                </Button>
              ) : (!sending || (canQueue && hasContent)) ? (
                <Button size="icon" onClick={onSubmit} disabled={!hasContent} className="rounded-full"
                  aria-label={canQueue ? "加入队列" : "发送消息"} title={canQueue ? "加入队列" : "发送消息"}><ArrowUp /></Button>
              ) : null}
              {sending && (!submissionPending || canQueue) ? (
                <Button size="icon" variant="secondary" onClick={onStop} className="rounded-full" aria-label="停止生成">
                  <Square />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
