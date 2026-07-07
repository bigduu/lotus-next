import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getErrorMessage } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import { ConfirmDialog } from "./ConfirmDialog"
import { StatusLine } from "./StatusLine"
import type {
  ModelLimitOverride,
  SectionMessage,
  SystemBambooConfig,
  SystemConfigApi,
} from "./useSystemConfig"

interface GlobalDefault {
  max_context_tokens: number
  max_output_tokens: number
  safety_margin: number
}

const FALLBACK_DEFAULT: GlobalDefault = {
  max_context_tokens: 1_000_000,
  max_output_tokens: 128_000,
  safety_margin: 10_000,
}

/** Editable row (numbers kept as strings so typing is never clamped). */
interface RowDraft {
  id: string
  model_pattern: string
  max_context_tokens: string
  max_output_tokens: string
  safety_margin: string
}

let rowCounter = 0
const nextRowId = () => `row-${rowCounter++}`

function toRow(o: ModelLimitOverride): RowDraft {
  return {
    id: nextRowId(),
    model_pattern: o.model_pattern,
    max_context_tokens: String(o.max_context_tokens),
    max_output_tokens: o.max_output_tokens != null ? String(o.max_output_tokens) : "",
    safety_margin: o.safety_margin != null ? String(o.safety_margin) : "",
  }
}

function parseIntField(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isInteger(value) ? value : null
}

/** Ported from lotus `validateOverrides` — same rules, hardcoded Chinese text. */
function validateRows(rows: RowDraft[]): { overrides: ModelLimitOverride[] } | { error: string } {
  const seen = new Set<string>()
  const overrides: ModelLimitOverride[] = []
  for (const row of rows) {
    const pattern = row.model_pattern.trim()
    if (!pattern) return { error: "模型匹配串不能为空" }
    const key = pattern.toLowerCase()
    if (seen.has(key)) return { error: `模型 "${pattern}" 重复` }
    seen.add(key)

    const ctx = parseIntField(row.max_context_tokens)
    if (ctx === null || ctx < 1000) return { error: `"${pattern}" 的上下文窗口需为不小于 1000 的整数` }

    const out = parseIntField(row.max_output_tokens)
    if (out === null || out < 1) return { error: `"${pattern}" 的最大输出需为不小于 1 的整数` }
    if (out > ctx) return { error: `"${pattern}" 的最大输出不能超过上下文窗口` }

    let margin: number | undefined
    if (row.safety_margin.trim()) {
      const parsed = parseIntField(row.safety_margin)
      if (parsed === null || parsed < 0) return { error: `"${pattern}" 的安全余量需为非负整数` }
      if (parsed >= ctx) return { error: `"${pattern}" 的安全余量必须小于上下文窗口` }
      margin = parsed
    }

    overrides.push({
      model_pattern: pattern,
      max_context_tokens: ctx,
      max_output_tokens: out,
      ...(margin !== undefined ? { safety_margin: margin } : {}),
    })
  }
  return { overrides }
}

/** 模型限额 — per-model token-budget overrides(config `model_limits`). */
export function SectionModelLimits({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  const [globalDefault, setGlobalDefault] = useState<GlobalDefault>(FALLBACK_DEFAULT)
  // Seed once at mount: re-seeding on config change would clobber in-progress
  // edits whenever another section saves (each save reloads the shared config).
  // Our own save re-seeds explicitly via setRows in `save`.
  const [rows, setRows] = useState<RowDraft[]>(() => (config.model_limits ?? []).map(toRow))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  useEffect(() => {
    serviceFactory
      .getModelLimitDefaults()
      .then((r) => {
        const first = r.model_limits?.[0]
        if (first) {
          setGlobalDefault({
            max_context_tokens: first.max_context_tokens || FALLBACK_DEFAULT.max_context_tokens,
            max_output_tokens: first.max_output_tokens || FALLBACK_DEFAULT.max_output_tokens,
            safety_margin: first.safety_margin || FALLBACK_DEFAULT.safety_margin,
          })
        }
      })
      .catch(() => {})
  }, [])

  const updateRow = (id: string, patch: Partial<RowDraft>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: nextRowId(),
        model_pattern: "",
        max_context_tokens: String(globalDefault.max_context_tokens),
        max_output_tokens: String(globalDefault.max_output_tokens),
        safety_margin: "",
      },
    ])
  }

  const save = async () => {
    const result = validateRows(rows)
    if ("error" in result) {
      setMsg({ kind: "error", text: result.error })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const saved = await saveSection({ model_limits: result.overrides })
      setRows((saved.model_limits ?? []).map(toRow))
      setMsg({ kind: "ok", text: "已保存" })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const resetAll = async () => {
    setBusy(true)
    setResetError(null)
    try {
      await saveSection({ model_limits: [] })
      setRows([])
      setConfirmReset(false)
      setMsg({ kind: "ok", text: "已恢复为全局默认" })
    } catch (e) {
      setResetError(getErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">模型限额</div>
        <Button size="sm" variant="secondary" onClick={addRow}>
          <Plus className="size-4" /> 新增
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        按模型覆盖 token 预算;未覆盖的模型使用全局默认:上下文{" "}
        {globalDefault.max_context_tokens.toLocaleString()} / 输出{" "}
        {globalDefault.max_output_tokens.toLocaleString()} / 安全余量{" "}
        {globalDefault.safety_margin.toLocaleString()}。
      </p>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无覆盖,全部模型使用全局默认。</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="space-y-1.5 rounded-md border bg-muted/30 p-2">
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1 font-mono text-xs"
                  placeholder="模型匹配串(如 gpt-4o)"
                  value={row.model_pattern}
                  onChange={(e) => updateRow(row.id, { model_pattern: e.target.value })}
                />
                <button
                  onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                  aria-label="删除"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground">上下文窗口</div>
                  <Input
                    inputMode="numeric"
                    value={row.max_context_tokens}
                    onChange={(e) => updateRow(row.id, { max_context_tokens: e.target.value })}
                  />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground">最大输出</div>
                  <Input
                    inputMode="numeric"
                    value={row.max_output_tokens}
                    onChange={(e) => updateRow(row.id, { max_output_tokens: e.target.value })}
                  />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground">安全余量(可选)</div>
                  <Input
                    inputMode="numeric"
                    placeholder={String(globalDefault.safety_margin)}
                    value={row.safety_margin}
                    onChange={(e) => updateRow(row.id, { safety_margin: e.target.value })}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <StatusLine msg={msg} />
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setResetError(null)
              setConfirmReset(true)
            }}
          >
            全部恢复默认
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="清除全部模型限额?"
        description="将删除所有按模型的覆盖,全部模型恢复为全局默认限额。"
        confirmLabel="清除"
        busy={busy}
        error={resetError}
        onConfirm={() => void resetAll()}
      />
    </section>
  )
}
