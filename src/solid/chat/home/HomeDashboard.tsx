import {
  BarChart3, BookOpen, Bug, Clock, Code, FileSearch, FileText, GitCompare, HelpCircle,
  Loader2, MessageSquare, Network, Pin, Plus, Search, Wrench,
} from "@lucide/solid"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { Dynamic } from "@solidjs/web"
import { uiText } from "@shared/i18n/text"
import type { ChatItem } from "@shared/types/chatMessages"
import { surfaceMotion } from "@shared/theme/motion"
import { CATEGORY_LABELS, CATEGORY_ORDER, setPendingTemplatePrompt, TASK_TEMPLATES, type TaskTemplate } from "@/lib/taskTemplates"
import { cn } from "@/lib/utils"
import { createUiLocale } from "../../shell/uiText"
import { BrandMark } from "../../ui/brand-mark"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"

const cardInteraction = "button-interaction outline-none focus-visible:ring-2"
const icons: Record<string, typeof Plus> = {
  plus: Plus, code: Code, wrench: Wrench, gitCompare: GitCompare, bug: Bug, helpCircle: HelpCircle,
  barChart: BarChart3, network: Network, fileSearch: FileSearch, fileText: FileText, bookOpen: BookOpen,
  clock: Clock, search: Search,
}

function relativeTime(timestamp: string | number | undefined, locale: string, text: typeof uiText) {
  if (!timestamp) return ""
  const ms = typeof timestamp === "number" ? timestamp : Date.parse(timestamp)
  if (!Number.isFinite(ms)) return ""
  const elapsed = Date.now() - ms
  if (elapsed < 60_000) return text("just_now_de6785d9")
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
  if (elapsed < 3_600_000) return format.format(-Math.floor(elapsed / 60_000), "minute")
  if (elapsed < 86_400_000) return format.format(-Math.floor(elapsed / 3_600_000), "hour")
  return format.format(-Math.floor(elapsed / 86_400_000), "day")
}

function SessionShortcut(props: {
  chat: ChatItem
  locale: string
  text: typeof uiText
  onOpen: () => void
}) {
  return <button type="button" onClick={props.onOpen}
    class={cn(cardInteraction, "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent")}>
    <Switch fallback={<MessageSquare class="size-3.5 shrink-0 text-muted-foreground" />}>
      <Match when={props.chat.isRunning}><Loader2 class="size-3.5 shrink-0 animate-spin text-primary" /></Match>
      <Match when={props.chat.pinned}><Pin class="size-3.5 shrink-0 text-muted-foreground" /></Match>
    </Switch>
    <span class="min-w-0 flex-1 truncate">{props.chat.title || props.text("new_session_c57c30bc")}</span>
    <span class="shrink-0 text-[11px] text-muted-foreground">
      {relativeTime(props.chat.lastActivityAt ?? props.chat.updatedAt, props.locale, props.text)}
    </span>
  </button>
}

/** Session shortcuts and editable quick-start suggestions for the empty main pane. */
export function HomeDashboard(props: {
  chats: readonly ChatItem[]
  onOpenSession: (id: string) => void
  onPickTemplate: (prefill: string) => void
  onDescribeTask: () => void
}) {
  const locale = createUiLocale()
  const text: typeof uiText = (key, values) => uiText(key, { ...values, lng: locale() })
  const [query, setQuery] = createSignal("")
  let search!: HTMLInputElement

  function clearSearch() {
    setQuery("")
    search.focus()
  }

  function pick(template: TaskTemplate) {
    setPendingTemplatePrompt(template.taskPrompt ?? null)
    props.onPickTemplate(template.prefill)
  }

  const sections = createMemo(() => {
    const chats = props.chats
    return [
      { key: "running", label: text("running_1f0eb99b"), items: chats.filter((chat) => chat.isRunning).slice(0, 5) },
      { key: "pinned", label: text("pinned_section"), items: chats.filter((chat) => chat.pinned && !chat.isRunning).slice(0, 5) },
      { key: "recent", label: text("recent_997a5e6e"), items: chats.filter((chat) => !chat.isRunning && !chat.pinned && !chat.parentSessionId).slice(0, 5) },
    ].filter((section) => section.items.length)
  })
  const catalog = createMemo(() => {
    locale()
    return TASK_TEMPLATES.map((template) => ({ template, title: template.title, description: template.description }))
  })
  const groups = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const choices = catalog().filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle))
    return CATEGORY_ORDER.map((category) => ({
      category, label: CATEGORY_LABELS[category], items: choices.filter((item) => item.template.category === category),
    })).filter((group) => group.items.length)
  })

  return <div data-testid="home-dashboard" class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto w-full max-w-6xl px-4 py-6">
      <div class="mb-5 flex items-center gap-3">
        <BrandMark class="size-9" />
        <div>
          <h1 class="text-base font-semibold">{text("start_a_new_task_625aa91a")}</h1>
          <p class="text-xs text-muted-foreground">{text("choose_a_template_or_type_below_6a05a677")}</p>
        </div>
      </div>

      <Show when={sections().length}>
        <div class="mb-5 grid gap-3 sm:grid-cols-2">
          <For each={sections()} keyed={(section) => section.key}>{(section) =>
            <section class="rounded-lg border p-2">
              <div class="mb-1 px-1 text-xs font-medium text-muted-foreground">{section().label}</div>
              <For each={section().items} keyed={(chat) => chat.id}>{(chat) =>
                <SessionShortcut chat={chat()} locale={locale()} text={text} onOpen={() => props.onOpenSession(chat().id)} />
              }</For>
            </section>
          }</For>
        </div>
      </Show>

      <div class="mb-3">
        <Input ref={(element) => { search = element }} aria-label={text("search_templates_28062b4d")}
          value={query()} placeholder={text("search_templates_28062b4d")} class="h-9"
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query() || event.isComposing || event.keyCode === 229) return
            event.preventDefault()
            event.stopPropagation()
            clearSearch()
          }} />
      </div>

      <For each={groups()} keyed={(group) => group.category}>{(group) =>
        <section class="mb-4">
          <div class="mb-1.5 text-xs font-medium text-muted-foreground">{group().label}</div>
          <div class="grid gap-2 sm:grid-cols-2">
            <For each={group().items} keyed={(item) => item.template.id}>{(item) =>
              <button type="button" onClick={() => pick(item().template)}
                class={cn(cardInteraction, "flex items-start gap-2.5 rounded-xl border p-3 text-left hover:bg-accent")}>
                <span aria-hidden="true" class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <Dynamic component={icons[item().template.icon] ?? Plus} class="size-4" />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-medium">{item().title}</span>
                  <span class="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{item().description}</span>
                </span>
              </button>
            }</For>
          </div>
        </section>
      }</For>

      <Show when={groups().length === 0}>
        <div role="status" class={cn(surfaceMotion, "surface-fade rounded-xl border bg-card px-4 py-8 text-center")}>
          <Search class="mx-auto mb-3 size-5 text-primary" aria-hidden="true" />
          <p class="text-sm text-muted-foreground">{text("no_matching_templates_0f5e1c5f")}</p>
          <div class="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={clearSearch}>{text("clear_search_b6f00afa")}</Button>
            <Button type="button" size="sm" onClick={() => props.onDescribeTask()}>{text("home_describe_task")}</Button>
          </div>
        </div>
      </Show>
    </div>
  </div>
}
