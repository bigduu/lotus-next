import { Brain, ChevronRight, Terminal } from "@lucide/solid"
import type { ComponentProps, JSX } from "@solidjs/web"
import { createEffect, createMemo, createSignal, createUniqueId, For, Match, omit, onSettled, Show, Switch } from "solid-js"

import "@/components/chat/ProcessActivity.css"
import { cn } from "@/lib/utils"
import { readLocalImage } from "@shared/services/FileOperationsService"

import { LazyAssistantMarkdown } from "../../markdown/LazyAssistantMarkdown"
import { createUiText } from "../../shell/uiText"
import { MessageBody } from "../MessageBody"
import type { SideChatSources } from "./SideChatSourceActions"
import type { createMessageActions } from "../message-actions/createMessageActions"
import { MessageActions, MessageEdit } from "../message-actions/MessageActions"
import {
  formatElapsedDuration, itemTimestamp, messageRuntimeNotice, renderItemKey, toolCallCount,
  type DisplayItem, type ProcessItem, type ProcessPart, type RenderItem, type TurnCollapseItem,
} from "./historyProjection"
import { extractProcessBrief } from "./processBrief"
import { ToolActivity, type HistoryDisclosure } from "./ToolActivity"

type RowActions = {
  disclosure: HistoryDisclosure
  theme: "light" | "dark"
  onOpenLink: (url: string) => void
  onPreviewImage: (url: string) => void
  sideChat?: SideChatSources
  messageActions?: ReturnType<typeof createMessageActions>
  afterProcess?: (key: string) => JSX.Element
}

type ReasoningPart = Extract<ProcessPart, { kind: "reasoning" }>
type ToolPart = Extract<ProcessPart, { kind: "tools" }>

function DisclosurePanel(props: ComponentProps<"div"> & { expanded: boolean }) {
  return (
    <div data-disclosure-panel="" data-state={props.expanded ? "open" : "closed"}
      aria-hidden={props.expanded ? "false" : "true"} inert={!props.expanded}
      class={cn("disclosure-panel", props.class)} {...omit(props, "children", "class", "expanded")}>
      <div class="disclosure-panel-clip">{props.children}</div>
    </div>
  )
}

function toggleDisclosure(trigger: HTMLButtonElement, disclosure: HistoryDisclosure, key: string) {
  const doc = trigger.ownerDocument
  const panel = doc.getElementById(trigger.getAttribute("aria-controls") ?? "")
  if (disclosure.isOpen(key) && panel?.contains(doc.activeElement)) trigger.focus({ preventScroll: true })
  disclosure.toggle(key)
}

function Reasoning(props: { part: ReasoningPart; rowKey: string; disclosure: HistoryDisclosure }) {
  const text = createUiText()
  const id = createUniqueId()
  const open = () => props.disclosure.isOpen(props.rowKey)
  return (
    <div class="px-3.5">
      <button type="button" aria-expanded={open() ? "true" : "false"} aria-controls={id} data-reasoning-toggle=""
        onClick={(event) => toggleDisclosure(event.currentTarget, props.disclosure, props.rowKey)}
        class="reasoning-toggle inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Brain class="reasoning-brain size-3.5 shrink-0" aria-hidden="true" />
        <span>{text("reasoning_a62acb18")}</span>
        <ChevronRight aria-hidden="true"
          class={cn("reasoning-chevron size-3.5 transition-transform duration-(--motion-normal) ease-(--motion-ease)", open() && "rotate-90")} />
      </button>
      <DisclosurePanel id={id} expanded={open()}>
        <div tabindex={open() ? 0 : -1} role="region" aria-label={text("reasoning_a62acb18")}
          class="mb-1.5 mt-1 max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {props.part.text}
        </div>
      </DisclosurePanel>
    </div>
  )
}

type ToolPreview = { id: string; part: ToolPart }

function hasCall(part: ToolPart, id: string) {
  return part.items.some((message) => "type" in message && message.type === "tool_call"
    && message.toolCalls.some((call) => call.toolCallId === id))
}

function canAnimateHandoff() {
  return document.body.dataset.vdiSafe !== "true" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function ToolHandoff(props: { onFinish: () => void; children: ComponentProps<"div">["children"] }) {
  let element!: HTMLDivElement
  onSettled(() => {
    if (!canAnimateHandoff() || typeof element.animate !== "function") {
      props.onFinish()
      return
    }
    const styles = getComputedStyle(element)
    const duration = styles.getPropertyValue("--motion-normal").trim()
    const milliseconds = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1_000)
    const height = `${element.getBoundingClientRect().height}px`
    const animation = element.animate([
      { height, opacity: 1, transform: "translateY(0)" },
      { height, opacity: 1, transform: "translateY(0)", offset: 0.35 },
      { height: "0px", opacity: 0, transform: "translateY(-12px) scale(0.98)" },
    ], {
      duration: Number.isFinite(milliseconds) ? milliseconds : 220,
      easing: styles.getPropertyValue("--motion-ease").trim() || "ease",
      fill: "forwards",
    })
    void animation.finished.then(props.onFinish, () => {})
    return () => animation.cancel()
  })
  return <div ref={(node) => { element = node }} data-process-handoff="" aria-hidden="true"
    style={{ overflow: "hidden", "transform-origin": "top left" }}>{props.children}</div>
}

function ProcessPreview(props: RowActions & { item: ProcessItem; open: boolean }) {
  const current = createMemo<ToolPreview | undefined>(() => {
    if (props.open || !props.item.active) return undefined
    const part = props.item.parts.findLast((entry): entry is ToolPart => entry.kind === "tools" && !!entry.runningCallIds?.size)
    const id = part && [...part.runningCallIds ?? []].at(-1)
    return part && id ? { id, part } : undefined
  })
  const [leaving, setLeaving] = createSignal<ToolPreview>()
  let previous: ToolPreview | undefined
  createEffect(() => [current(), props.open] as const, ([preview, open]) => {
    const old = previous
    previous = preview
    if (open || !canAnimateHandoff()) setLeaving(undefined)
    else if (old && old.id !== preview?.id) {
      const part = props.item.parts.findLast((entry): entry is ToolPart => entry.kind === "tools" && hasCall(entry, old.id))
      setLeaving({ id: old.id, part: part ?? old.part })
    }
  })
  return (
    <div class="-mx-3.5">
      <Show when={leaving()} keyed>{(entry) => (
        <ToolHandoff onFinish={() => setLeaving((latest) => latest === entry ? undefined : latest)}>
          <ToolActivity part={entry.part} groupKey={props.item.key} preview previewCallId={entry.id}
            disclosure={props.disclosure} onPreviewImage={props.onPreviewImage} />
        </ToolHandoff>
      )}</Show>
      <Show when={current()}>{(entry) => (
        <div data-process-current="">
          <ToolActivity part={entry().part} groupKey={props.item.key} active preview previewCallId={entry().id}
            disclosure={props.disclosure} onPreviewImage={props.onPreviewImage} />
        </div>
      )}</Show>
    </div>
  )
}

function Process(props: RowActions & { item: ProcessItem; live?: boolean }) {
  const text = createUiText()
  const contentId = createUniqueId()
  const open = () => props.disclosure.isOpen(props.item.key)
  const count = createMemo(() => toolCallCount([props.item]))
  const label = createMemo(() => {
    const start = itemTimestamp(props.item)
    const end = itemTimestamp(props.item, "last")
    const duration = !props.live && count() && start !== null && end !== null ? formatElapsedDuration(end - start, text) : null
    return duration ? text("processed_db5f0926", { v0: duration })
      : text(props.item.active && props.item.thinking ? "thinking_64088d8c" : "process_activity")
  })
  const toolCountLabel = () => count() > 0 ? text("process_tool_count", { count: count() }) : ""
  const newestReasoning = () => props.item.parts.findLast((part) => part.kind === "reasoning") as ReasoningPart | undefined
  const newestTool = () => props.item.parts.findLast((part) => part.kind === "tools" && !!part.runningCallIds?.size) as ToolPart | undefined
  const brief = createMemo(() => {
    const reasoning = extractProcessBrief(newestReasoning()?.text)
    const progress = extractProcessBrief(newestTool() ? undefined : props.item.status ?? undefined) || toolCountLabel()
    return props.item.active && !props.item.thinking ? progress || reasoning || label() : reasoning || progress || label()
  })
  const summary = () => (
    <>
      <Show when={props.item.parts.length}>
        <ChevronRight class="process-activity-icon size-3.5" aria-hidden="true" />
        <Show when={brief() !== label()}><span class="process-activity-label">{label()}</span></Show>
      </Show>
      <span data-process-brief="" data-process-shimmer={props.item.active && props.item.thinking ? "" : undefined}
        class={cn("process-activity-brief", props.item.active && props.item.thinking && "process-activity-shimmer")}>{brief()}</span>
      <Show when={toolCountLabel() && brief() !== toolCountLabel()}>
        <span class="process-activity-count">{toolCountLabel()}</span>
      </Show>
    </>
  )
  return (
    <div data-process-activity="" data-expansion-key={props.item.key} class="process-activity">
      <Show when={props.item.parts.length} fallback={
        <div data-process-status="" role="status" class="process-activity-toggle cursor-default rounded-sm text-xs">{summary()}</div>
      }>
        <button type="button" data-process-toggle="" aria-label={label()} aria-expanded={open() ? "true" : "false"}
          aria-controls={contentId} class="process-activity-toggle rounded-sm text-xs"
          onClick={(event) => toggleDisclosure(event.currentTarget, props.disclosure, props.item.key)}>
          {summary()}
        </button>
        <Show when={props.live}><ProcessPreview {...props} open={open()} /></Show>
        <DisclosurePanel id={contentId} data-process-content="" role="region" aria-label={label()} expanded={open()}
          class="process-activity-content">
          <div class="process-activity-content-body">
            <div class="-mx-3.5 flex flex-col gap-2">
              <For each={props.item.parts} keyed={false}>{(part, index) => {
                const reasoning = () => {
                  const value = part()
                  return value.kind === "reasoning" ? value : undefined
                }
                const toolDetails = () => {
                  const value = part()
                  return value.kind === "tools" ? value : undefined
                }
                return (
                  <Switch>
                    <Match when={reasoning()}>{(thought) => (
                      <Reasoning part={thought()} rowKey={`${props.item.key}:reasoning:${index}`} disclosure={props.disclosure} />
                    )}</Match>
                    <Match when={toolDetails()}>{(tools) => (
                      <div data-expansion-key={`tools-${tools().items[0]?.id}`}>
                        <ToolActivity part={tools()} groupKey={`${props.item.key}:tools:${index}`}
                          expandedSingle={count() === 1} active={props.item.active}
                          disclosure={props.disclosure} onPreviewImage={props.onPreviewImage} />
                      </div>
                    )}</Match>
                  </Switch>
                )
              }}</For>
            </div>
          </div>
        </DisclosurePanel>
      </Show>
    </div>
  )
}

function FoldedTurn(props: RowActions & { item: TurnCollapseItem }) {
  const text = createUiText()
  const contentId = createUniqueId()
  const open = () => props.disclosure.isOpen(props.item.key)
  const detail = createMemo(() => {
    const { startedAt, finishedAt, toolCalls } = props.item
    const elapsed = startedAt !== null && finishedAt !== null ? formatElapsedDuration(finishedAt - startedAt, text) : null
    if (elapsed) return toolCalls > 0 ? text("turn_collapse_processed_with_tools", { v0: elapsed, count: toolCalls })
      : text("processed_db5f0926", { v0: elapsed })
    return toolCalls > 0 ? text("process_tool_count", { count: toolCalls }) : text("process_activity")
  })
  return (
    <div data-turn-collapse={props.item.key} data-expansion-key={props.item.key}>
      <button type="button" data-turn-toggle="" aria-expanded={open() ? "true" : "false"} aria-controls={contentId}
        aria-label={detail()} class="flex w-full items-center gap-3 py-1 text-xs text-muted-foreground"
        onClick={(event) => toggleDisclosure(event.currentTarget, props.disclosure, props.item.key)}>
        <span class="h-px flex-1 bg-border" aria-hidden="true" />
        <span class="whitespace-nowrap" data-turn-brief="">{detail()}</span>
        <ChevronRight class={cn("size-3 shrink-0", open() && "rotate-90")} aria-hidden="true" />
        <span class="h-px flex-1 bg-border" aria-hidden="true" />
      </button>
      <DisclosurePanel id={contentId} expanded={open()} class="turn-collapse-content">
        <div class="flex flex-col gap-2 pt-1">
          <For each={props.item.items} keyed={renderItemKey}>{(item) => <RenderHistoryRow {...props} item={item()} />}</For>
        </div>
      </DisclosurePanel>
    </div>
  )
}

function MessageRow(props: RowActions & { item: Extract<RenderItem, { kind: "msg" }> }) {
  const text = createUiText()
  const key = () => renderItemKey(props.item)
  const source = () => props.sideChat?.allows(key()) ? props.sideChat : undefined
  const target = () => props.messageActions?.target(key())
  const user = () => props.item.m.role === "user"
  const editing = () => {
    const draft = props.messageActions?.editing
    return user() && draft?.target.key === key() ? draft : null
  }
  const actions = () => <Show when={target()}>
    {(item) => <MessageActions controller={props.messageActions!} target={item()} sideChat={source()} />}
  </Show>
  const runtimeNotice = createMemo(() => messageRuntimeNotice(props.item.m))
  const streamed = () => props.item.streaming && props.item.m.role === "assistant" && props.item.m.type === "text"
    ? props.item.m.content : undefined
  return (
    <div data-message-row={props.item.m.id} data-message-occurrence={key()} tabindex={-1} class="group min-w-0 rounded-lg">
      <Show when={editing()} fallback={
        <div class={cn("min-w-0", target() && "flex items-end gap-1")}>
          <Show when={user()}>{actions()}</Show>
          <div class="min-w-0 flex-1" data-side-chat-source={source() ? props.item.m.id : undefined}
            data-side-chat-occurrence={source() ? key() : undefined}>
            <Switch fallback={
              <MessageBody message={props.item.m} theme={props.theme} onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} />
            }>
              <Match when={runtimeNotice()}>{(notice) => (
                <div data-runtime-notice={notice().runtimeKind}
                  class="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                  <Terminal class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-foreground">{text("runtime_notice_background_exec_title_1b8a7ef0")}</div>
                    <div class="mt-0.5">{text("runtime_notice_background_exec_body_c90c9f52")}</div>
                    <Show when={notice().execSessionId}>{(handle) => (
                      <div class="mt-1 break-all font-mono text-xs opacity-70">
                        {text("runtime_notice_background_exec_handle_0f9a6d34", { v0: handle() })}
                      </div>
                    )}</Show>
                  </div>
                </div>
              )}</Match>
              <Match when={streamed()}>{(content) => (
                <div data-message-role="assistant" class="min-w-0 py-2">
                  <LazyAssistantMarkdown theme={props.theme} text={text} isStreaming
                    onOpenLink={props.onOpenLink} onPreviewImage={props.onPreviewImage} readImage={readLocalImage}>
                    {content()}
                  </LazyAssistantMarkdown>
                </div>
              )}</Match>
            </Switch>
          </div>
          <Show when={!user()}>{actions()}</Show>
        </div>
      }>
        {(draft) => <MessageEdit controller={props.messageActions!} target={draft().target} />}
      </Show>
    </div>
  )
}

export function RenderHistoryRow(props: RowActions & { item: DisplayItem; live?: boolean }) {
  return (
    <Switch>
      <Match when={props.item.kind === "collapsedTurn" ? props.item : undefined}>{(turn) => (
        <FoldedTurn {...props} item={turn()} />
      )}</Match>
      <Match when={props.item.kind === "process" ? props.item : undefined}>{(process) => (
        <>
          <Process {...props} item={process()} />
          {props.afterProcess?.(process().key)}
        </>
      )}</Match>
      <Match when={props.item.kind === "msg" ? props.item : undefined}>{(message) => (
        <MessageRow {...props} item={message()} />
      )}</Match>
    </Switch>
  )
}
