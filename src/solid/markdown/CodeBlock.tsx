import type { CodeHighlighterPlugin } from "streamdown"
import { createEffect, createSignal, For, Show } from "solid-js"
import { lazyCodePlugin, STREAMDOWN_THEMES } from "../../components/chat/streamdownConfig"

type HighlightedCode = NonNullable<ReturnType<CodeHighlighterPlugin["highlight"]>>

export function CodeBlock(props: { code: string; language: string; incomplete: boolean }) {
  const [highlighted, setHighlighted] = createSignal<HighlightedCode | null>(null)

  createEffect(
    () => ({ code: props.code, language: props.language, incomplete: props.incomplete }),
    ({ code, language, incomplete }) => {
      setHighlighted(null)
      if (!language || incomplete) return
      let active = true
      lazyCodePlugin.highlight(
        { code, language: language as Parameters<CodeHighlighterPlugin["highlight"]>[0]["language"], themes: STREAMDOWN_THEMES },
        (result) => { if (active) setHighlighted(result) },
      )
      return () => { active = false }
    },
  )

  return (
    <div class="my-2 grid min-w-0 gap-1 rounded-xl border bg-card p-1.5" data-streamdown="code-block"
      data-incomplete={props.incomplete ? "" : undefined}>
      <Show when={props.language}>
        <div class="flex h-5 items-center px-1 font-mono text-xs leading-4 text-muted-foreground"
          data-streamdown="code-block-header">{props.language}</div>
      </Show>
      <div class="rounded-md bg-background px-3 py-2.5 font-mono text-sm font-normal leading-[1.55]"
        data-streamdown="code-block-body">
        <pre class="m-0 bg-transparent p-0 text-inherit leading-inherit">
          <code class="font-normal">
            <Show when={highlighted()} fallback={props.code}>
              {(result) => <For each={result().tokens}>{(line, index) => (
                <>{index() ? "\n" : ""}<For each={line}>{(token) => (
                  <span style={{
                    "--lotus-code-color-light": token.htmlStyle?.["--shiki-light"] ?? token.color,
                    "--lotus-code-color-dark": token.htmlStyle?.["--shiki-dark"] ?? token.color,
                  }} data-solid-code-token>{token.content}</span>
                )}</For></>
              )}</For>}
            </Show>
          </code>
        </pre>
      </div>
    </div>
  )
}
