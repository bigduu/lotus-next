// Current built Lotus against the actual isolated Bamboo Host/Native Runtime.
// A controlled provider chooses operations; live semantics are separate.
import { test, expect } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"
import type { PendingRequest } from "../src/services/tickets/types.js"

test("five real Worker questions E/B/D/A/C, exact approvals, references and browser recovery", async ({ page }) => {
  const file = process.env.LOTUS_TICKET_FIXTURE_INFO
  if (!file) throw new Error("Start the opt-in current_lotus_five_native_questions_browser_fixture and set LOTUS_TICKET_FIXTURE_INFO")
  const fixture = JSON.parse(readFileSync(file, "utf8")) as {
    origin: string; api: string; session_id: string; done: string; works: Record<string, string>
    approvals: Record<string, { work_id: string; request_id: string }>
  }
  const browserErrors: string[] = []
  page.on("pageerror", (error) => browserErrors.push(error.message))
  const api = async (path: string, body?: unknown) => {
    const response = body ? await page.request.post(fixture.api + path, { data: body }) : await page.request.get(fixture.api + path)
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  try {
    await page.addInitScript(({ origin, session }) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_backend_endpoint_v1", origin)
      localStorage.setItem("lotus_next_last_session", session)
    }, { origin: fixture.origin, session: fixture.session_id })
    await page.goto(fixture.origin)
    const overview = page.getByTestId("ticket-work-overview")
    await expect(overview).toBeVisible()
    await expect(overview).toContainText("5 个待答问题")
    const initial = await api("/tickets/inspect", { ids: Object.values(fixture.works), sections: ["requests"], depth: 0, budget_bytes: 65536 })
    const requests = Object.fromEntries(initial.data.map((row: { ticket: { contract: { title: string } }; requests: PendingRequest[] }) => [row.ticket.contract.title, row.requests[0]])) as Record<string, PendingRequest>
    await page.screenshot({ path: file.replace(/\.json$/, "-five-pending.png"), fullPage: true })

    // The same ordinary composer carries an optional reference. Chatter must
    // leave every pending request open and cannot grant approval.
    const eCard = page.getByTestId("ticket-request-" + requests.E.id)
    await eCard.locator("..").getByRole("button", { name: "在普通输入中引用此请求" }).click()
    await expect(page.getByTestId("ticket-reference")).toBeVisible()
    const composer = page.locator("[data-composer-region] textarea").first()
    await composer.fill("今天只聊聊天，不批准任何动作。")
    await composer.press("Enter")
    await expect(page.getByTestId("message-request-reference")).toContainText(requests.E.id)
    await expect(overview).toContainText("5 个待答问题")

    for (const [index, id] of ["E", "B", "D", "A", "C"].entries()) {
      const card = page.getByTestId("ticket-request-" + requests[id].id)
      await card.getByRole("textbox").fill("答案 " + id)
      await card.getByRole("button", { name: "回答", exact: true }).click()
      await expect(overview).toContainText(`${4 - index} 个待答问题`)
      await expect.poll(async () => {
        const view = await api("/tickets/inspect", { ids: [fixture.works[id]], sections: ["requests", "submissions"], depth: 0, budget_bytes: 65536 })
        return [view.data[0].ticket.state, view.data[0].ticket.generation, view.data[0].requests[0].answer]
      }).toEqual(["submitted", 2, "答案 " + id])
      if (index === 1) {
        await page.reload()
        await expect(overview).toContainText("3 个待答问题")
        await expect(overview).toContainText("已处理和失效请求（2）")
      }
    }
    await expect(overview).toContainText("5 项待验收")
    await page.screenshot({ path: file.replace(/\.json$/, "-five-submitted.png"), fullPage: true })

    const a = fixture.approvals["批准A"], b = fixture.approvals["批准B"]
    const inspectApproval = await api("/tickets/inspect", { ids: [b.work_id], sections: ["requests"], depth: 0, budget_bytes: 65536 })
    const old = inspectApproval.data[0].requests[0] as PendingRequest
    await page.getByTestId("ticket-request-" + a.request_id).getByRole("button", { name: "批准此动作" }).click()
    await expect(overview).toContainText("1 个待批准动作")
    await expect(page.getByTestId("ticket-request-" + b.request_id)).toContainText("待处理")
    let scope = await api("/tickets/scope")
    await api("/tickets/update", { operation_id: "browser-change-B", binding: scope.binding,
      expected_seq: scope.overview.snapshot.seq, expected_epoch: scope.overview.snapshot.authority_epoch,
      operations: [{ op: "update_contract", work_id: b.work_id, contract: { title: "批准B", objective: "Changed material action, approval invalidated", constraints: [], acceptance: ["新证据"], user_acceptance_required: true, allowed_tools: ["Task"] } }] })
    await overview.getByRole("button", { name: "刷新", exact: true }).click()
    await overview.getByText(/已处理和失效请求/).click()
    await expect(page.getByTestId("ticket-request-" + b.request_id)).toContainText("已被替换")
    expect(await page.getByTestId("ticket-request-" + b.request_id).getByRole("button", { name: "批准此动作" }).count()).toBe(0)
    scope = await api("/tickets/scope")
    const stale = await page.request.post(fixture.api + "/tickets/requests/respond", { data: {
      operation_id: "browser-stale-B", binding: scope.binding, expected_seq: scope.overview.snapshot.seq,
      expected_epoch: scope.overview.snapshot.authority_epoch,
      target: { request_id: old.id, work_id: old.work_id, assignment_id: old.assignment_id, generation: old.generation, contract_revision: old.contract_revision, prompt_revision: old.prompt_revision },
      decision: { kind: "approval", fingerprint: old.kind.kind === "approval" ? old.kind.fingerprint : "invalid", approve: true },
    } })
    expect([409, 422]).toContain(stale.status())
    await page.reload()
    await expect(overview).toContainText("0 个待批准动作")
    await page.screenshot({ path: file.replace(/\.json$/, "-approval-superseded.png"), fullPage: true })
    expect(browserErrors).toEqual([])
    writeFileSync(fixture.done, JSON.stringify({ pass: true, answered: ["E", "B", "D", "A", "C"], current_generation: 2, submitted: 5, stale_status: stale.status(), browser_errors: browserErrors }))
  } catch (error) {
    writeFileSync(fixture.done, JSON.stringify({ pass: false, error: String(error), browser_errors: browserErrors }))
    throw error
  }
})
