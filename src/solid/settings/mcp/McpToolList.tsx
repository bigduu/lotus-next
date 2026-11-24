import { createEffect, createSignal, For, Show } from "solid-js"
import { mcpService, type McpToolInfo } from "@services/mcp"
import { createUiText } from "../../shell/uiText"

export function McpToolList(props: { serverId: string; version: number }) {
  const text = createUiText()
  const [tools, setTools] = createSignal<McpToolInfo[] | null>(null)
  const [error, setError] = createSignal(false)
  createEffect(
    () => [props.serverId, props.version] as const,
    ([serverId]) => {
      let active = true
      setError(false)
      void mcpService.getTools(serverId).then((result) => {
        if (active) setTools(result)
      }).catch(() => { if (active) setError(true) })
      return () => { active = false }
    },
  )
  return (
    <Show when={!error()} fallback={<p class="text-xs break-all text-destructive" role="alert">{text("could_not_load_tools_7cf37d72")}</p>}>
      <Show when={tools()} fallback={<p role="status" class="text-xs text-muted-foreground">{text("loading_tools_3ab9b8bc")}</p>}>
        {(items) => <Show when={items().length > 0} fallback={<p class="text-xs text-muted-foreground">{text("this_server_exposes_no_tools_ca0d2452")}</p>}>
          <ul class="space-y-1.5">
            <For each={items()} keyed={(tool: McpToolInfo) => tool.alias}>
              {(tool) => <li class="rounded-md border bg-muted/30 p-2">
                <div class="font-mono text-xs font-medium break-all">{tool().original_name}</div>
                <Show when={tool().description}>
                  <div class="mt-0.5 text-xs whitespace-pre-wrap text-muted-foreground">{tool().description}</div>
                </Show>
                <Show when={tool().parameters != null}>
                  <details class="mt-1">
                    <summary class="cursor-pointer text-[11px] text-muted-foreground select-none">{text("argument_schema_50a739a9")}</summary>
                    <pre class="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed">{JSON.stringify(tool().parameters, null, 2)}</pre>
                  </details>
                </Show>
              </li>}
            </For>
          </ul>
        </Show>}
      </Show>
    </Show>
  )
}
