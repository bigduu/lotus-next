import { ChevronRight, Globe } from "@lucide/solid"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { splitAssistantProviderBlocks } from "@/lib/assistantProviderBlocks"
import { cn } from "@/lib/utils"
import type { AssistantMarkdownProps } from "./AssistantMarkdown"
import type { MarkdownText } from "./text"

const providerLabelClass = "inline-flex max-w-full items-center rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"

function ProviderPending(props: { name?: string; text: MarkdownText; literal?: true }) {
  const label = () => props.literal ? props.text("tool_5ca6730d")
    : props.name ? props.text("built_in_tool_b3950b4c", { v0: props.name })
    : props.text("built_in_tool_starting_d9a432a6")
  return <div role="status" data-provider-tool-state="streaming" class={cn("my-1.5", providerLabelClass)}
    aria-label={props.literal ? label() : props.name ? props.text("built_in_tool_is_running_aa5c6389", { v0: props.name })
      : props.text("starting_built_in_tool_4b6a8d81")}>
    <span class="truncate">{label()}</span>
  </div>
}

function ProviderTool(props: AssistantMarkdownProps & {
  name: string
  literal?: true
  text: MarkdownText
  prose: Component<AssistantMarkdownProps>
}) {
  const [open, setOpen] = createSignal(false)
  const Prose = props.prose
  return <div class="my-1.5" data-provider-tool={props.name}>
    <button type="button" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen((current) => !current)}
      class={cn(providerLabelClass, "gap-1.5 transition-colors hover:bg-muted")}>
      <Globe class="size-3 shrink-0" aria-hidden="true" />
      <span class="truncate">{props.literal ? `${props.text("tool_5ca6730d")} ·` : props.text("built_in_tool_508add77")} {props.name}</span>
      <ChevronRight class={cn("size-3 shrink-0 transition-transform", open() && "rotate-90")} aria-hidden="true" />
    </button>
    <Show when={open()}>
      <div class="mt-1.5 overflow-x-auto rounded-lg border bg-card/50 p-2.5 text-xs">
        <Show when={props.literal} fallback={<Prose {...props} isStreaming={false} />}>
          <pre class="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{props.children}</pre>
        </Show>
      </div>
    </Show>
  </div>
}

export function ProviderMarkdown(props: AssistantMarkdownProps & {
  prose: Component<AssistantMarkdownProps>
  text: MarkdownText
}) {
  const parts = createMemo(() => splitAssistantProviderBlocks(props.children, props.isStreaming === true))
  const text: MarkdownText = (key, values) => props.text(key, values)
  const Prose = props.prose
  return <For each={parts()} keyed={false}>{(part) => {
    const prose = () => {
      const entry = part()
      return entry.kind === "prose" ? entry : null
    }
    const tool = () => {
      const entry = part()
      return entry.kind === "tool" ? entry : null
    }
    const pending = () => {
      const entry = part()
      return entry.kind === "pending" ? entry : null
    }
    return <>
      <Show when={prose()}>{(entry) => <Prose {...props} isStreaming={entry().streaming}>
        {entry().source}
      </Prose>}</Show>
      <Show when={tool()?.name} keyed>{(name) => <ProviderTool {...props} name={name} text={text} literal={tool()?.literal}>
        {tool()?.source ?? ""}
      </ProviderTool>}</Show>
      <Show when={pending()}>{(entry) => <ProviderPending name={entry().name} text={text} literal={entry().literal} />}</Show>
    </>
  }}</For>
}
