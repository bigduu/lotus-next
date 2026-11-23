import { createSignal, onCleanup, Show } from "solid-js"
import { getErrorMessage } from "@services/api"
import { localCodexClaimUrl, prepareCodexHandoff, type CodexHandoffSelector } from "@services/tickets/codexHandoff"
import { copyText } from "@shared/utils/clipboard"

import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"

export function CodexWorkHandoff(props: { selector: CodexHandoffSelector }) {
  const text = createUiText()
  const [preparing, setPreparing] = createSignal(false)
  const [command, setCommand] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let request: AbortController | undefined
  let active = true
  onCleanup(() => {
    active = false
    request?.abort()
  })

  async function prepare() {
    if (request || !localCodexClaimUrl()) return
    const controller = new AbortController()
    request = controller
    setPreparing(true)
    setCommand(null)
    setCopied(false)
    setError(null)
    try {
      const next = await prepareCodexHandoff(props.selector, controller.signal)
      if (!controller.signal.aborted) setCommand(next)
    } catch (failure) {
      if (!controller.signal.aborted) setError(getErrorMessage(failure))
    } finally {
      request = undefined
      if (!controller.signal.aborted) setPreparing(false)
    }
  }

  async function copy() {
    const value = command()
    if (!value) return
    setError(null)
    try {
      await copyText(value)
      if (active && command() === value) setCopied(true)
    } catch (failure) {
      if (active && command() === value) setError(getErrorMessage(failure))
    }
  }

  return (
    <Show when={localCodexClaimUrl()}>
      <div class="mt-4 space-y-2">
        <Button variant="outline" size="sm" disabled={preparing()} onClick={() => void prepare()}>
          {text(command() ? "project_work_codex_prepare_again" : "project_work_continue_in_codex")}
        </Button>
        <Show when={preparing()}><p role="status" class="text-xs">{text("project_work_codex_preparing")}</p></Show>
        <Show when={command()}>{(value) => (
          <div class="space-y-2">
            <p class="text-xs text-muted-foreground">{text("project_work_codex_terminal_help")}</p>
            <textarea readonly value={value()} rows={3} spellcheck={false} aria-label={text("project_work_codex_command")}
              class="w-full rounded-md border bg-muted px-2 py-1.5 font-mono text-xs" />
            <Button variant="secondary" size="sm" onClick={() => void copy()}>{text("project_work_codex_copy")}</Button>
            <Show when={copied()}><span class="ml-2 text-xs" role="status">{text("project_work_codex_copied")}</span></Show>
          </div>
        )}</Show>
        <Show when={error()}><p role="alert" class="text-sm text-destructive">{error()}</p></Show>
      </div>
    </Show>
  )
}
