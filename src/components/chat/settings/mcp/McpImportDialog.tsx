import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import {
  MAX_MCP_IMPORT_BYTES, McpImportFailure, mcpIdsKey, parseMcpImport, previewMcpImport,
} from "@services/mcp/importConfig"
import type { McpImportMode, McpImportRequest, McpImportResult } from "@services/mcp/types"

export interface McpImportCompletion { result: McpImportResult; refreshed: boolean }

export function McpImportDialog({ existingIds, listConfirmed, listRevision, onClose, onReturnFocus, onImport, onReload }: {
  existingIds: string[]
  listConfirmed: boolean
  listRevision: number
  onClose: () => void
  onReturnFocus: () => void
  onImport: (request: McpImportRequest, expectedIdsKey: string) => Promise<McpImportCompletion>
  onReload: () => Promise<boolean>
}) {
  const [draft, setDraft] = useState({ text: "", revision: 0 })
  const [mode, setMode] = useState<McpImportMode>("merge")
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [completion, setCompletion] = useState<McpImportCompletion | null>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const fileRead = useRef(0)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; fileRead.current += 1 }
  }, [])

  const parsed = useMemo(() => parseMcpImport(draft.text), [draft.text])
  const ids = parsed.ok ? parsed.value.servers.map((server) => server.id) : []
  const preview = previewMcpImport(ids, existingIds, mode)
  const existingKey = mcpIdsKey(existingIds)
  // No JSON or secret-bearing content in the confirmation token.
  const confirmationKey = JSON.stringify([draft.revision, mode, listRevision, existingKey, mcpIdsKey(preview.removed)])
  const confirmed = acceptedKey === confirmationKey && listConfirmed
  const canSubmit = parsed.ok && listConfirmed && !busy && !reading && !uncertain && !completion && (mode === "merge" || confirmed)

  const edit = (text: string) => {
    if (busyRef.current) return
    fileRead.current += 1
    setReading(false)
    setDraft((previous) => ({ text, revision: previous.revision + 1 }))
    setAcceptedKey(null); setError(null); setUncertain(false)
  }
  const selectFile = async (file: File | undefined) => {
    if (!file || busyRef.current) return
    edit("")
    const generation = fileRead.current
    if (file.size > MAX_MCP_IMPORT_BYTES) { setError("JSON 文件不能超过 1 MiB。"); return }
    setReading(true)
    try {
      const text = await file.text()
      if (!alive.current || generation !== fileRead.current) return
      edit(text)
    } catch {
      if (alive.current && generation === fileRead.current) setError("无法读取 JSON 文件。请重新选择文件或粘贴配置；文件内容未发送。")
    } finally {
      if (alive.current && generation === fileRead.current) setReading(false)
    }
  }
  const submit = async () => {
    if (busyRef.current || !canSubmit || !parsed.ok) return
    busyRef.current = true
    setBusy(true); setError(null)
    try {
      const result = await onImport({ mcpServers: parsed.value.mcpServers, mode }, existingKey)
      if (!alive.current) return
      setCompletion(result)
      setDraft((previous) => ({ text: "", revision: previous.revision + 1 }))
      setAcceptedKey(null)
    } catch (failure) {
      if (!alive.current) return
      const safe = failure instanceof McpImportFailure ? failure : new McpImportFailure("uncertain")
      setError(safe.message); setUncertain(safe.kind === "uncertain")
      setAcceptedKey(null)
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  const refresh = async () => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setAcceptedKey(null)
    try {
      const refreshed = await onReload()
      if (!alive.current) return
      if (completion) setCompletion({ ...completion, refreshed })
      if (!refreshed) setError("无法刷新实际列表，请稍后再试；没有发送导入请求。")
    } catch {
      if (alive.current) setError("无法刷新实际列表，请稍后再试；没有发送导入请求。")
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  const close = () => { if (!busyRef.current) { fileRead.current += 1; onClose() } }

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) close() }}>
      <ResponsiveDialogContent className="sm:max-w-2xl" dismissable={!busy} showCloseButton={false}
        onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus() }}
        onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus() }}>
        <div className="border-b px-4 py-3.5">
          <ResponsiveDialogTitle>导入 MCP JSON</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="mt-2 text-xs">
            仅导入 mcpServers。配置只保留在此窗口内存，不写入浏览器存储；启用的服务器会在提交前尝试启动。
          </ResponsiveDialogDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {completion ? (
            <section role="status" aria-label="导入结果" className="space-y-2 rounded-md border p-3 text-sm">
              <h3 className="font-medium">导入已完成</h3>
              <p>新增 {completion.result.added} · 更新 {completion.result.updated} · 删除 {completion.result.removed}</p>
              <p className="break-all text-xs">服务器 ID：{completion.result.server_ids.join("、")}</p>
              <p className="text-xs text-muted-foreground">{completion.refreshed ? "实际服务器列表与运行状态已刷新。" : "配置已提交，但列表刷新失败。请刷新实际列表核对运行状态。"}</p>
            </section>
          ) : (
            <>
              <label className="block space-y-1.5 text-xs">
                <span>MCP JSON 配置</span>
                <Textarea value={draft.text} onChange={(event) => edit(event.target.value)} disabled={busy}
                  className="min-h-44 resize-y font-mono text-xs" autoComplete="off" autoCapitalize="off" spellCheck={false}
                  placeholder={'{"mcpServers":{"example":{"command":"mcp-server","disabled":true}}}'} />
              </label>
              <label className="block space-y-1.5 text-xs">
                <span>选择 JSON 文件</span>
                <input type="file" accept=".json,application/json" disabled={busy} className="block w-full min-w-0 text-xs"
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file) }} />
              </label>
              <p className="text-xs text-muted-foreground">最多 1 MiB、500 个服务器。预览只显示 ID、传输方式和启用状态，不显示环境变量或请求头值。</p>
              {reading ? <p role="status" className="text-xs">正在读取 JSON 文件…</p> : null}
              {draft.text && !parsed.ok ? <p role="alert" className="text-xs text-destructive">{parsed.error}</p> : null}
              <fieldset disabled={busy} className="space-y-2">
                <legend className="mb-1 text-xs font-medium">导入模式</legend>
                {(["merge", "replace"] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="mcp-import-mode" value={value} checked={mode === value} onChange={() => {
                      if (busyRef.current) return
                      setMode(value); setAcceptedKey(null); setError(null); setUncertain(false)
                    }} />
                    {value === "merge" ? "Merge（按 ID 合并）" : "Replace（替换全部）"}
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">{mode === "merge"
                ? "Merge 按 ID 整条覆盖同名服务器，不递归合并字段；未出现在导入中的 ID 会保留。"
                : "Replace 使用导入集合替换配置，并删除缺席的 ID。预览基于当前列表，不能锁定其他客户端的并发修改。"}</p>
              {parsed.ok ? (
                <section aria-label="导入预览" className="space-y-2 rounded-md border p-3 text-xs">
                  <h3 className="font-medium">导入预览</h3>
                  <p>预计新增 {preview.added.length} · 整条更新 {preview.updated.length} · 删除 {preview.removed.length}</p>
                  <ul className="max-h-36 space-y-1 overflow-y-auto">
                    {parsed.value.servers.map((server) => <li key={server.id} className="break-all">
                      <code>{server.id}</code> · {server.transport === "streamable_http" ? "Streamable HTTP" : server.transport} · {server.enabled ? "启用" : "停用"}
                    </li>)}
                  </ul>
                  <p>服务器 ID 取自 mcpServers 的键；内部 id 字段不改变目标。</p>
                  {mode === "replace" ? <div>
                    <p className="font-medium text-destructive">将删除的现有 ID：</p>
                    {preview.removed.length ? <ul aria-label="将删除的服务器" className="max-h-28 overflow-y-auto">
                      {preview.removed.map((id) => <li key={id} className="break-all"><code>{id}</code></li>)}
                    </ul> : <p>无</p>}
                    <label className="mt-3 flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy || reading || !listConfirmed}
                        onChange={(event) => setAcceptedKey(event.target.checked ? confirmationKey : null)} />
                      我确认使用当前配置替换，并删除以上服务器
                    </label>
                  </div> : null}
                </section>
              ) : null}
              {!listConfirmed ? <p role="alert" className="text-xs text-destructive">当前服务器列表尚未确认，请刷新后再导入。</p> : null}
            </>
          )}
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          {uncertain ? <p className="text-xs text-muted-foreground">核对实际列表后，修改配置或重新选择模式才能开始新的导入；不会重放本次写入。</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t p-3">
          {(error || !listConfirmed || (completion && !completion.refreshed)) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>刷新当前列表</Button> : null}
          <Button ref={cancel} size="sm" variant="secondary" disabled={busy} onClick={close}>{completion ? "完成" : "取消"}</Button>
          {!completion ? <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>{busy ? "导入中…" : "导入"}</Button> : null}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
