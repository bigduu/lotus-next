import { useState } from "react"
import { ticketClient } from "@services/tickets/client"
import { artifactDownloadName } from "@services/tickets/artifactDownload"
import { effectiveStatus, type TicketState } from "@services/tickets/state"
import type { PendingRequest, WorkState } from "@services/tickets/types"
import type { useTicketWork } from "@/hooks/useTicketWork"

const labels: Record<WorkState, string> = { draft: "草稿", ready: "待派发", active: "执行中", submitted: "待验收", accepted: "已验收", blocked: "阻塞", cancelled: "已取消" }
const requestLabels = { open: "待处理", answered: "已回答", approved: "已批准", denied: "已拒绝", superseded: "已被替换", expired: "已过期", consumed: "授权已使用" }
type Controller = ReturnType<typeof useTicketWork>

function RequestCard({ controller, state, request }: { controller: Controller; state: TicketState; request: PendingRequest }) {
  const [answer, setAnswer] = useState("")
  const status = effectiveStatus(state, request)
  const title = state.works[request.work_id]?.ticket.contract.title ?? request.work_id
  const retry = controller.uncertain[request.id]
  const busy = controller.busy[request.id] === true
  const disabled = !controller.canRespond || busy || status !== "open" || !!retry
  const approval = request.kind.kind === "approval" ? request.kind : null
  return <article data-testid={"ticket-request-" + request.id} className="rounded-xl border bg-background p-3 text-sm">
    <div className="flex items-center justify-between gap-2"><strong>{title}</strong><span>{requestLabels[status]}</span></div>
    <div className="mb-2 text-xs text-muted-foreground">{approval ? "批准" : "问题"} · 尝试 {request.generation} · 问题版本 {request.prompt_revision}</div>
    <p className="whitespace-pre-wrap break-words">{request.prompt}</p>
    {approval ? <dl className="my-2 grid grid-cols-2 gap-2 text-xs">
      <dt>动作</dt><dd>{approval.action.kind} → {approval.action.target}</dd>
      {approval.action.amount ? <><dt>金额</dt><dd>{approval.action.amount}</dd></> : null}
      <dt>数据</dt><dd className="break-all font-mono">{approval.action.data_hash}</dd>
      <dt>权限</dt><dd>{approval.action.permissions.join("、") || "无额外权限"}</dd>
      <dt>风险</dt><dd>{approval.action.risk}</dd>
    </dl> : null}
    {status === "open" && !approval ? <form className="mt-2 flex gap-2" onSubmit={(event) => {
      event.preventDefault(); if (!answer.trim() || disabled) return
      void controller.respond(request, { kind: "question", answer: answer.trim() }).then((ok) => { if (ok) setAnswer("") })
    }}>
      <input aria-label={"回答 " + title} value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={disabled} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" />
      <button type="submit" disabled={disabled || !answer.trim()} className="rounded-md border px-2 py-1 disabled:opacity-50">{busy ? "发送中…" : "回答"}</button>
    </form> : null}
    {status === "open" && approval ? <div className="mt-2 flex gap-2">
      <button type="button" disabled={disabled} className="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => void controller.respond(request, { kind: "approval", fingerprint: approval.fingerprint, approve: true })}>批准此动作</button>
      <button type="button" disabled={disabled} className="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => void controller.respond(request, { kind: "approval", fingerprint: approval.fingerprint, approve: false })}>拒绝</button>
    </div> : null}
    {retry ? <div className="mt-2 text-muted-foreground"><p>上次发送尚未确认。</p><button type="button" disabled={!controller.connected || busy} className="underline disabled:opacity-50" onClick={() => void controller.respond(request, retry.decision)}>确认同一请求的发送结果</button></div> : null}
    {request.answer ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">已保存：{request.answer}</p> : null}
  </article>
}

export function TicketWorkPanel({ controller, onReference }: { controller: Controller; onReference?: (request: PendingRequest) => void }) {
  const state = controller.state
  const [artifactError, setArtifactError] = useState<string | null>(null)
  if (!state) return null
  const overview = state.current.scope.overview.data
  const open = Object.values(state.requests).filter((q) => effectiveStatus(state, q) === "open")
  const history = Object.values(state.requests).filter((q) => effectiveStatus(state, q) !== "open")
  return <aside aria-label="工作总览" data-testid="ticket-work-overview" style={{ maxHeight: "45vh" }} className="mx-4 mb-3 overflow-y-auto rounded-xl border bg-muted/20 p-3">
    <div className="flex items-center justify-between gap-3"><strong>工作总览</strong><button type="button" className="text-xs underline" onClick={() => void controller.refresh()}>刷新</button></div>
    <p className="my-2 text-xs text-muted-foreground">{overview.work_count} 项工作 · {overview.open_questions} 个待答问题 · {overview.open_approvals} 个待批准动作 · {overview.needs_acceptance} 项待验收</p>
    {!state.current.complete ? <p role="status" className="text-sm text-muted-foreground">当前只显示部分工作；未显示的工作不代表不存在。</p> : null}
    {!controller.connected ? <p role="status" className="text-sm text-muted-foreground">连接未确认，回答和批准暂不可用。</p> : null}
    {!state.current.scope.mutation_enabled || state.current.scope.health !== "writable" ? <p className="text-sm text-muted-foreground">当前工单为只读。</p> : null}
    {controller.error ? <p role="alert" className="my-2 text-sm text-destructive">{controller.error}</p> : null}
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.values(state.works).filter((v) => !v.ticket.archived).map((view) => <section key={view.ticket.id} className="rounded-lg border p-2 text-xs">
        <div className="flex justify-between gap-2"><strong>{view.ticket.contract.title}</strong><span>{labels[view.ticket.state]}</span></div>
        <p className="mt-1 break-words text-muted-foreground">{view.ticket.contract.objective}</p>
        {view.ticket.blocked ? <p className="mt-1 text-muted-foreground">{view.ticket.blocked.reason}</p> : null}
        {view.submissions.filter((s) => s.id === view.ticket.accepted_submission || s.id === view.ticket.current_submission).map((submission) => <div key={submission.id} className="mt-2">
          <p>{submission.stale ? "旧版本成果，仅供核对" : submission.id === view.ticket.accepted_submission ? "已验收成果" : "已提交成果，等待验收"}</p>
          {submission.evidence.map((line, index) => <p key={index} className="break-words">{line}</p>)}
          {submission.artifacts.map((artifact, index) => <button type="button" key={artifact.sha256} style={{ marginRight: "0.5rem" }} className="underline" onClick={() => {
            void ticketClient.artifact(artifact.sha256).then((blob) => {
              const href = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = href; link.download = artifactDownloadName(artifact.sha256, artifact.uri, blob.type); link.click(); URL.revokeObjectURL(href)
            }).catch(() => setArtifactError("成果暂时无法读取，请刷新后重试。"))
          }}>读取成果 {index + 1}</button>)}
        </div>)}
      </section>)}
    </div>
    {artifactError ? <p role="alert">{artifactError}</p> : null}
    {open.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{open.map((request) => <div key={request.id}>
      <RequestCard controller={controller} state={state} request={request} />
      {onReference ? <button type="button" className="mt-1 text-xs underline" onClick={() => onReference(request)}>在普通输入中引用此请求</button> : null}
    </div>)}</div> : null}
    {history.length ? <details className="mt-3"><summary className="cursor-pointer text-xs">已处理和失效请求（{history.length}）</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{history.map((request) => <RequestCard key={request.id} controller={controller} state={state} request={request} />)}</div></details> : null}
  </aside>
}
