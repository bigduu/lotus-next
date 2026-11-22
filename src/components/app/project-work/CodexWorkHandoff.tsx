import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { getErrorMessage } from "@services/api"
import { localCodexClaimUrl, prepareCodexHandoff, type CodexHandoffSelector } from "@services/tickets/codexHandoff"
import { uiText } from "@shared/i18n/ui"
import { copyText } from "@shared/utils/clipboard"

export function CodexWorkHandoff({ selector }: { selector: CodexHandoffSelector }) {
  const request = useRef<AbortController | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [command, setCommand] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  if (!localCodexClaimUrl()) return null

  async function prepare() {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setPreparing(true)
    setCommand(null)
    setCopied(false)
    setError(null)
    try {
      const next = await prepareCodexHandoff(selector, controller.signal)
      if (!controller.signal.aborted) setCommand(next)
    } catch (failure) {
      if (!controller.signal.aborted) setError(getErrorMessage(failure))
    } finally {
      request.current = null
      if (!controller.signal.aborted) setPreparing(false)
    }
  }

  async function copy() {
    if (!command) return
    setError(null)
    try {
      await copyText(command)
      setCopied(true)
    } catch (failure) {
      setError(getErrorMessage(failure))
    }
  }

  return <div className="mt-4 space-y-2">
    <Button variant="outline" size="sm" disabled={preparing} onClick={() => void prepare()}>
      {uiText(command ? "project_work_codex_prepare_again" : "project_work_continue_in_codex")}
    </Button>
    {preparing ? <p role="status" className="text-xs">{uiText("project_work_codex_preparing")}</p> : null}
    {command ? <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{uiText("project_work_codex_terminal_help")}</p>
      <textarea
        readOnly value={command} rows={3} spellCheck={false}
        aria-label={uiText("project_work_codex_command")}
        className="w-full rounded-md border bg-muted px-2 py-1.5 font-mono text-xs"
      />
      <Button variant="secondary" size="sm" onClick={() => void copy()}>{uiText("project_work_codex_copy")}</Button>
      {copied ? <span className="ml-2 text-xs" role="status">{uiText("project_work_codex_copied")}</span> : null}
    </div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>
}
