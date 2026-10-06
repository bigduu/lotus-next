import { uiLanguage, uiText, useUiLocale } from "@shared/i18n/ui"
import { useMemo, useState, type ReactNode } from "react"
import {
  Plus,
  Code,
  Wrench,
  GitCompare,
  Bug,
  HelpCircle,
  BarChart3,
  Network,
  FileSearch,
  FileText,
  BookOpen,
  Clock,
  Search,
  Pin,
  Loader2,
  MessageSquare,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { BrandMark } from "@/components/ui/brand-mark"
import { cn } from "@/lib/utils"
import {
  TASK_TEMPLATES,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  setPendingTemplatePrompt,
  type TaskTemplate,
} from "@/lib/taskTemplates"
import type { ChatItem } from "@shared/types/chatMessages"

const ICONS: Record<string, ReactNode> = {
  plus: <Plus className="size-4" />,
  code: <Code className="size-4" />,
  wrench: <Wrench className="size-4" />,
  gitCompare: <GitCompare className="size-4" />,
  bug: <Bug className="size-4" />,
  helpCircle: <HelpCircle className="size-4" />,
  barChart: <BarChart3 className="size-4" />,
  network: <Network className="size-4" />,
  fileSearch: <FileSearch className="size-4" />,
  fileText: <FileText className="size-4" />,
  bookOpen: <BookOpen className="size-4" />,
  clock: <Clock className="size-4" />,
  search: <Search className="size-4" />,
}

function relativeTime(ts: string | number | undefined): string {
  if (!ts) return ""
  const ms = typeof ts === "number" ? ts : Date.parse(ts)
  if (!Number.isFinite(ms)) return ""
  const diff = Date.now() - ms
  if (diff < 60_000) return uiText("just_now_de6785d9")
  const formatter = new Intl.RelativeTimeFormat(uiLanguage(), { numeric: "always" })
  if (diff < 3_600_000) return formatter.format(-Math.floor(diff / 60_000), "minute")
  if (diff < 86_400_000) return formatter.format(-Math.floor(diff / 3_600_000), "hour")
  return formatter.format(-Math.floor(diff / 86_400_000), "day")
}

function SessionMiniRow({ chat, onOpen }: { chat: ChatItem; onOpen: () => void }) {
  useUiLocale()
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
    >
      {chat.isRunning ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : chat.pinned ? (
        <Pin className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{chat.title || uiText("new_session_c57c30bc")}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {relativeTime(chat.lastActivityAt ?? chat.updatedAt)}
      </span>
    </button>
  )
}

/**
 * No-session home view for the MAIN pane: running/pinned/recent sessions at a
 * glance + the quick-start template grid. Picking a template prefills the
 * composer (the user can edit before sending) and stashes the template's task
 * prompt for composition after the selected base prompt on the first send.
 */
export function HomeDashboard({
  chats,
  onOpenSession,
  onPickTemplate,
}: {
  chats: ChatItem[]
  onOpenSession: (id: string) => void
  /** Receives the template's prefill text for the composer draft. */
  onPickTemplate: (prefill: string) => void
}) {
  useUiLocale()
  const [query, setQuery] = useState("")

  const running = useMemo(() => chats.filter((c) => c.isRunning).slice(0, 5), [chats])
  const pinned = useMemo(
    () => chats.filter((c) => c.pinned && !c.isRunning).slice(0, 5),
    [chats],
  )
  const recent = useMemo(
    () =>
      chats
        .filter((c) => !c.isRunning && !c.pinned && !c.parentSessionId)
        .slice(0, 5),
    [chats],
  )

  const q = query.trim().toLowerCase()
  const filtered = q
    ? TASK_TEMPLATES.filter(
        (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      )
    : TASK_TEMPLATES

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: filtered.filter((t) => t.category === cat),
  })).filter((g) => g.items.length > 0)

  const pick = (tpl: TaskTemplate) => {
    setPendingTemplatePrompt(tpl.taskPrompt ?? null)
    onPickTemplate(tpl.prefill)
  }

  const sections: Array<{ label: string; items: ChatItem[] }> = [
    { label: uiText("running_1f0eb99b"), items: running },
    { label: uiText("pinned_section"), items: pinned },
    { label: uiText("recent_997a5e6e"), items: recent },
  ].filter((s) => s.items.length > 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-5 flex items-center gap-3">
          <BrandMark className="size-9" />
          <div>
            <h1 className="text-base font-semibold">{uiText("start_a_new_task_625aa91a")}</h1>
            <p className="text-xs text-muted-foreground">{uiText("choose_a_template_or_type_below_6a05a677")}</p>
          </div>
        </div>

        {sections.length > 0 ? (
          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            {sections.map((s) => (
              <section key={s.label} className="rounded-lg border p-2">
                <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">{s.label}</div>
                {s.items.map((c) => (
                  <SessionMiniRow key={c.id} chat={c} onOpen={() => onOpenSession(c.id)} />
                ))}
              </section>
            ))}
          </div>
        ) : null}

        <div className="mb-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={uiText("search_templates_28062b4d")}
            className="h-9"
          />
        </div>

        {grouped.map(({ cat, items }) => (
          <section key={cat} className="mb-4">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {CATEGORY_LABELS[cat]}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => pick(tpl)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent",
                  )}
                >
                  <span className="mt-0.5 shrink-0 text-primary">{ICONS[tpl.icon] ?? ICONS.plus}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{tpl.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                      {tpl.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}

        {grouped.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{uiText("no_matching_templates_0f5e1c5f")}</p>
        ) : null}
      </div>
    </div>
  )
}
