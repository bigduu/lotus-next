import { useEffect, useRef, useState } from "react"
import { guidanceService, type PendingGuidance } from "@services/chat/guidance"
import { Button } from "@/components/ui/button"

const draftKey = (sessionId: string) => `lotus-next.guidance-draft.${sessionId}`
const readDraft = (sessionId: string): { id: string | null; text: string } => {
  try {
    const value = JSON.parse(sessionStorage.getItem(draftKey(sessionId)) ?? "null")
    if (value && typeof value.text === "string" && value.text.length <= 65536)
      return { text: value.text, id: typeof value.id === "string" ? value.id : null }
  } catch { /* A draft is optional; server admission remains authoritative. */ }
  return { id: null, text: "" }
}
const saveDraft = (sessionId: string, text: string, id: string | null) => {
  try {
    if (text) sessionStorage.setItem(draftKey(sessionId), JSON.stringify({ id, text }))
    else sessionStorage.removeItem(draftKey(sessionId))
  } catch { /* Keep the in-memory draft when browser storage is unavailable. */ }
}

/** Mount with a session key so late responses cannot clear another chat's draft. */
export function SessionGuidance({ sessionId, running }: { sessionId: string; running: boolean }) {
  const [initialDraft] = useState(() => readDraft(sessionId))
  const [text, setText] = useState(initialDraft.text)
  const [pending, setPending] = useState<PendingGuidance[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const retry = useRef<{ id: string; text: string } | null>(initialDraft.id ? { id: initialDraft.id, text: initialDraft.text } : null)
  useEffect(() => { saveDraft(sessionId, text, retry.current?.text === text ? retry.current.id : null) }, [sessionId, text])
  const requestActive = useRef(false)
  const refreshVersion = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const version = ++refreshVersion.current
      try {
        const result = await guidanceService.list(sessionId)
        if (!disposed && version === refreshVersion.current) setPending(result.messages)
      } catch { /* Submission failures are shown separately; retain the last queue snapshot. */ }
      if (!disposed) timer = setTimeout(() => void poll(), running ? 1500 : 5000)
    }
    void poll()
    return () => { disposed = true; alive.current = false; clearTimeout(timer) }
  }, [sessionId, running])

  const submit = async () => {
    if (requestActive.current || !text.trim()) return
    requestActive.current = true
    setBusy(true); setError(""); setNotice("")
    const submission = retry.current?.text === text ? retry.current : { id: crypto.randomUUID(), text }
    retry.current = submission
    saveDraft(sessionId, submission.text, submission.id)
    try {
      const receipt = await guidanceService.send(sessionId, submission.id, submission.text)
      if (!alive.current) return
      retry.current = null
      setText((current) => current === submission.text ? "" : current)
      setNotice(receipt.activation_pending ? "指导已保存，等待运行恢复" : "指导已接收，将在下一次可用的模型调用时应用")
      const version = ++refreshVersion.current
      try {
        const result = await guidanceService.list(sessionId)
        if (alive.current && version === refreshVersion.current) setPending(result.messages)
      } catch { /* Durable acceptance is already confirmed. Poll will refresh the queue. */ }
    } catch {
      if (alive.current) setError("未能确认指导状态，原文已保留；重试会沿用同一条指导。")
    } finally { requestActive.current = false; if (alive.current) setBusy(false) }
  }
  const cancel = async (id: string) => {
    if (requestActive.current) return
    requestActive.current = true; setBusy(true); setError("")
    try {
      await guidanceService.cancel(sessionId, id)
      ++refreshVersion.current
      if (alive.current) setPending((items) => items.filter((item) => item.id !== id))
    } catch { if (alive.current) setError("未能撤回，指导可能已经开始应用，请刷新后确认。") }
    finally { requestActive.current = false; if (alive.current) setBusy(false) }
  }
  if (!running && pending.length === 0 && !text && !notice && !error) return null
  return <section aria-label="追加指导" className="mx-auto mb-2 w-[calc(100%-1.5rem)] max-w-2xl rounded-lg border p-3 text-sm">
    <div className="mb-2 font-medium">追加指导</div>
    {pending.map((item) => <div key={item.id} className="mb-2 flex items-center justify-between gap-2">
      <span className="min-w-0 whitespace-pre-wrap break-words">待应用：{item.text}</span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel(item.id)}>撤回</Button>
    </div>)}
    {(running || text) && <div className="flex items-end gap-2">
      <textarea aria-label="指导内容" placeholder="补充要求，将在下一次模型调用时应用" value={text} onChange={(event) => setText(event.target.value)} className="min-h-16 flex-1 resize-y rounded-md border bg-background p-2" />
      <Button size="sm" disabled={busy || !text.trim()} onClick={() => void submit()}>发送指导</Button>
    </div>}
    {notice && <p role="status" className="mt-2 text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </section>
}
