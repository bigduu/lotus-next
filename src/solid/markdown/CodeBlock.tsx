import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { HighlightedCode } from "./highlight/highlightCode"

export function CodeBlock(props: { code: string; language: string; incomplete: boolean }) {
  const input = createMemo(() => ({ code: props.code, language: props.language, incomplete: props.incomplete }), {
    equals: (previous, next) => previous.code === next.code && previous.language === next.language && previous.incomplete === next.incomplete,
  })
  const [highlighted, setHighlighted] = createSignal<{ input: ReturnType<typeof input>; lines: HighlightedCode } | null>(null)
  const lines = () => {
    const result = highlighted()
    return result?.input === input() ? result.lines : null
  }

  createEffect(input, (current) => {
    if (!current.language || current.incomplete) return
    let active = true
    void import("./highlight/highlightCode").then(({ highlightCode }) => highlightCode(current.code, current.language)).then(
      (lines) => { if (active && current === input()) setHighlighted({ input: current, lines }) },
      () => { /* The fenced source stays visible when highlighting is unavailable. */ },
    )
    return () => { active = false }
  })

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
            <Show when={lines()} fallback={props.code}>
              {(result) => <For each={result()}>{(line, index) => (
                <>{index() ? "\n" : ""}<For each={line}>{(token) => (
                  <span style={{
                    "--lotus-code-color-light": token.htmlStyle?.color ?? token.color,
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
