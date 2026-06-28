import { useRef } from "react"
import { X, Paperclip, FolderGit2, ChevronDown, ArrowUp, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SlashMenu } from "@/components/chat/SlashMenu"
import { FileMenu } from "@/components/chat/FileMenu"
import type { SkillDefinition } from "@shared/types/skill"
import type { WorkspaceFileEntry } from "@services/workspace/types"

type AttachmentView = { id: string; url: string; name: string }

export function Composer({
  draft,
  onDraftChange,
  onSubmit,
  onStop,
  sending,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onPreviewImage,
  selectedSkill,
  onClearSkill,
  onPickSkill,
  skills,
  slashQuery,
  atQuery,
  displayWorkspace,
  workspaceFiles,
  onPickFile,
  hasSession,
  onOpenWorkspacePicker,
}: {
  draft: string
  onDraftChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  sending: boolean
  attachments: AttachmentView[]
  onAddFiles: (files: FileList | File[]) => void
  onRemoveAttachment: (id: string) => void
  onPreviewImage: (src: string) => void
  selectedSkill: SkillDefinition | null
  onClearSkill: () => void
  onPickSkill: (skill: SkillDefinition) => void
  skills: SkillDefinition[]
  slashQuery: string | null
  atQuery: string | null
  displayWorkspace: string | null | undefined
  workspaceFiles: WorkspaceFileEntry[]
  onPickFile: (entry: WorkspaceFileEntry) => void
  hasSession: boolean
  onOpenWorkspacePicker: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="border-t px-3 py-3">
      {slashQuery !== null && (
        <SlashMenu skills={skills} query={slashQuery} onPick={onPickSkill} />
      )}
      {slashQuery === null && atQuery !== null && displayWorkspace ? (
        <FileMenu files={workspaceFiles} query={atQuery} onPick={onPickFile} />
      ) : null}
      {selectedSkill && (
        <div className="mx-auto mb-2 flex max-w-2xl">
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
      {attachments.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-2xl flex-wrap gap-2">
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
      {!hasSession ? (
        <div className="mx-auto mb-1.5 flex max-w-2xl items-center">
          <button
            onClick={onOpenWorkspacePicker}
            className="flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
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
        </div>
      ) : null}
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-2xl border bg-card px-2 py-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="添加图片"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </Button>
          <Textarea
            value={draft}
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
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSubmit()
              }
            }}
            placeholder="发送消息…"
            rows={1}
            className="max-h-40"
          />
        </div>
        {sending ? (
          <Button size="icon" variant="secondary" onClick={onStop} className="rounded-full">
            <Square />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={onSubmit}
            disabled={!draft.trim() && attachments.length === 0}
            className="rounded-full"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  )
}
