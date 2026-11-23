import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { createHash } from "node:crypto"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const id = "all-surface-session"
const at = "2026-10-25T04:51:29.725Z"
const timeoutId = "9ab6cd70-bc43-4fed-9f10-50c2873fa287"
const timeoutError = "Stream timed out: phase=transport_idle, deadline_ms=120000, provider=a2a3cebf-8abc-45cb-8407-66c90fd9a978, model=gpt-6-astra, last_transport_ms_ago=120002, last_semantic_ms_ago=120002ms, semantic_output_started=true, retry_safe=false. Diagnostic ID: " + timeoutId + "."
const timeoutDiagnostic = {
  schema_version: 1, kind: "stream_timeout", diagnostic_id: timeoutId, error_id: timeoutId, observed_at: at,
  provider: "a2a3cebf-8abc-45cb-8407-66c90fd9a978", model: "gpt-6-astra",
  session_hash: createHash("sha256").update("bamboo-provider-operational-log-v1\0" + id).digest("hex").slice(0, 16),
  run_id: "b65d9caa-1250-4a89-8d77-2c77b06c634b", phase: "transport_idle", deadline_ms: 120000,
  last_transport_ms_ago: 120002, last_semantic_ms_ago: 120002, semantic_output_started: true, retry_safe: false,
  last_http_status: null, retry_delay_ms: null,
}
const compatible = {
  session_version: 2, current_session_version: 2, status: "compatible",
  history_readable: true, execution_allowed: true, conflicts: [],
}
const conflict = {
  ...compatible, status: "conflict", session_version: 99, execution_allowed: false,
  conflicts: [{ code: "unsupported_session_version", message: "Synthetic version refusal" }],
}
const legacy = { ...compatible, status: "legacy_compatible", session_version: null }

async function fixture(page: Page, baseURL: string | undefined, type: "diagnostic" | "compatibility" | "source" | "approval") {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, id)
  const history = [{ id: "partial-answer", role: "assistant", content: "Retained partial answer", created_at: at }]
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, history, { serveStaticFromLocalServer: true })
  let diagnostic: typeof timeoutDiagnostic | null = type === "diagnostic" ? timeoutDiagnostic : null
  let compatibility: unknown = type === "compatibility" ? { ...compatible, status: "malformed" } : compatible
  const childId = "compatibility-fixture-child"
  let childCompatibility = conflict
  const childDecisions: unknown[] = []
  let agentChannel: WebSocketRoute | undefined
  if (type === "approval") {
    await page.routeWebSocket(/.*/, (socket) => {
      socket.onMessage((raw) => {
        const frame = JSON.parse(String(raw)) as { type: string; ch?: string }
        if (frame.type === "hello") socket.send(JSON.stringify({ type: "welcome" }))
        if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong" }))
        if (frame.type === "subscribe" && frame.ch === `agent.${id}`) agentChannel = socket
      })
    })
  }
  const session = {
    id, kind: "root", root_session_id: id, parent_session_id: null, root_orchestration_only: false,
    thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
    title: "Run status fixture", title_version: 1, model: "fixture-model", pinned: false,
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: history.length,
    is_running: type === "approval", last_run_status: type === "diagnostic" ? "error" : type === "approval" ? "running" : "completed",
    last_run_error: type === "diagnostic" ? timeoutError : null, subagent_count: 0, permission_mode: "default",
  }
  let detailReads = 0
  const writes: { method: string; path: string; body: unknown }[] = []
  await page.route("**/api/v1/**", (route) => {
    const request = route.request()
    const { pathname: path, searchParams } = new URL(request.url())
    if (request.method() !== "GET" && (path === "/api/v1/chat" || /^\/api\/v1\/(execute|sessions)\//.test(path))) {
      writes.push({ method: request.method(), path, body: request.postData() ? request.postDataJSON() : null })
      if (type === "source" && path === "/api/v1/chat") return route.fulfill({
        status: 409, json: { session_id: id, error: { code: "session_project_running_conflict", message: "Synthetic source conflict" } },
      })
    }
    if (path === "/api/v1/sessions") {
      const sessions = searchParams.get("kind") === "child" ? [] : [session]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    if (request.method() === "GET" && path === `/api/v1/sessions/${id}`) {
      detailReads += 1
      return route.fulfill({
        json: { session: { ...session, execution_compatibility: compatibility, last_run_diagnostic: diagnostic } },
        headers: { ETag: '"1"' },
      })
    }
    if (type === "approval" && path === `/api/v1/sessions/${childId}`) return route.fulfill({
      json: { session: { ...session, id: childId, kind: "child", root_session_id: id, parent_session_id: id, execution_compatibility: childCompatibility } },
    })
    if (type === "approval" && path === `/api/v1/child-approval/${childId}`) {
      childDecisions.push(request.postDataJSON())
      return route.fulfill({ json: { delivered: true } })
    }
    return route.fallback()
  })
  await page.goto(entryUrl)
  await expect(page.getByText("Retained partial answer", { exact: true })).toBeVisible()
  return {
    observed, writes, childDecisions,
    async sendApproval() {
      await expect.poll(() => !!agentChannel).toBe(true)
      agentChannel!.send(JSON.stringify({ ch: `agent.${id}`, seq: 1, event: {
        type: "child_approval_requested", child_session_id: childId, request_id: "approval-1",
        tool_name: "Bash", permission: "execute_command", resource: "echo fixture child",
      } }))
    },
    allowChild() { childCompatibility = compatible },
    changeCanonicalFailure() { session.last_run_error = "Synthetic newer terminal error" },
    get detailReads() { return detailReads },
    setCompatibility(value: unknown) { compatibility = value },
    withdrawDiagnostic() { diagnostic = null },
  }
}

test("Solid diagnostics read only on request, export the reviewed report, and withdraw absent details", async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL, "diagnostic")
  const open = page.getByRole("button", { name: "View diagnostics", exact: true })
  await expect(open).toBeVisible()
  expect(f.observed.staticUrls.some((url) => url.includes("/RunDiagnosticsDialogContent-"))).toBe(false)
  const baseline = f.detailReads
  await open.click()
  const dialog = page.getByRole("dialog", { name: "Run diagnostics", exact: true })
  const read = dialog.getByRole("button", { name: "Read service diagnostics", exact: true })
  const preview = dialog.locator('pre[aria-label="Diagnostic JSON preview"]')
  await expect(preview).toContainText('"canonical_status": "not_checked"')
  expect(f.detailReads).toBe(baseline)
  await read.click()
  await expect(dialog.getByRole("status")).toContainText("Read from the current saved session error.")
  await expect(dialog.locator("dl")).toContainText("No model stream activity")
  await expect(dialog.locator("dl")).toContainText("This request cannot be replayed automatically")
  const report = JSON.parse(await preview.textContent() ?? "null")
  expect(report.diagnostic).toMatchObject({
    kind: "stream_timeout", source: "canonical_read", canonical_status: "confirmed", model: "gpt-6-astra",
    deadline_ms: 120000, last_transport_ms_ago: 120002, last_semantic_ms_ago: 120002,
    semantic_output_started: true, retry_safe: false, attempt: null, request_id: null,
  })
  const requested = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download diagnostic JSON", exact: true }).click()
  const download = await requested
  expect(download.suggestedFilename()).toBe("bamboo-run-diagnostics.json")
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(report)

  f.withdrawDiagnostic()
  await read.click()
  await expect(preview).toContainText('"canonical_status": "not_provided"')
  await expect(dialog.locator("dl")).not.toContainText("120000 ms")
  expect(JSON.parse(await preview.textContent() ?? "null").diagnostic).toMatchObject({
    kind: null, deadline_ms: null, last_transport_ms_ago: null, last_semantic_ms_ago: null,
  })
  expect(f.detailReads).toBe(baseline + 2)
  f.changeCanonicalFailure()
  await read.click()
  await expect(preview).toHaveText("null")
  await expect(dialog.getByRole("button", { name: "Download diagnostic JSON", exact: true })).toBeDisabled()
  expect(f.writes).toEqual([])
  expect(f.observed.pageErrors).toEqual([])
})

test("Solid compatibility distinguishes a failed read, a confirmed conflict, and a readable legacy session", async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL, "compatibility")
  const notice = page.getByRole("region", { name: "Session execution compatibility", exact: true })
  const reread = notice.getByRole("button", { name: "Check compatibility again", exact: true })
  await expect(notice).toHaveAttribute("data-session-execution-blocked", "false")
  await expect(notice).toContainText("Compatibility could not be checked.")
  expect(f.writes).toEqual([])

  f.setCompatibility(conflict)
  await reread.click()
  await expect(notice).toHaveAttribute("data-session-execution-blocked", "true")
  await expect(notice).toHaveCount(1)
  const composer = page.locator('[data-composer-editor][contenteditable="true"]')
  await composer.fill("Preserve the unsent instruction")
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled()
  await composer.press("Enter")
  await expect(composer).toHaveText("Preserve the unsent instruction")
  await expect(page.getByText("Retained partial answer", { exact: true })).toBeVisible()
  expect(f.writes).toEqual([])

  f.setCompatibility(legacy)
  await reread.click()
  await expect(notice).toHaveAttribute("data-session-execution-blocked", "false")
  await expect(notice).toContainText("Legacy session: compatible")
  await expect(composer).toHaveText("Preserve the unsent instruction")
  expect(f.writes).toEqual([])
  expect(f.observed.pageErrors).toEqual([])
})

test("Solid source refusal preserves the draft and continues editing without replay", async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL, "source")
  const composer = page.locator('[data-composer-editor][contenteditable="true"]')
  await composer.fill("Keep this instruction after a source conflict")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  const recovery = page.getByRole("alert").filter({ hasText: "Your draft and original source are preserved" })
  await expect(recovery).toBeVisible()
  await expect(recovery.getByRole("button", { name: "Retry generation", exact: true })).toHaveCount(0)
  await recovery.getByRole("button", { name: "Continue editing", exact: true }).click()
  await expect(composer).toBeFocused()
  await expect(composer).toHaveText("Keep this instruction after a source conflict")
  expect(f.writes).toEqual([expect.objectContaining({ method: "POST", path: "/api/v1/chat" })])
  expect(f.observed.pageErrors).toEqual([])
})

test("Solid Child approval recovers its own compatibility without answering automatically", async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL, "approval")
  await f.sendApproval()
  const child = page.getByRole("region", { name: "Subagent approval request", exact: true })
  await expect(child.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  await expect(page.locator('[data-session-execution-blocked="true"]')).toHaveCount(1)
  await expect(page.locator("[data-approval-presentation]")).toHaveCount(0)
  expect(f.childDecisions).toEqual([])
  f.allowChild()
  await child.getByRole("button", { name: "Check compatibility again", exact: true }).click()
  const card = page.locator("[data-approval-presentation]")
  await expect(card).toContainText("echo fixture child")
  expect(f.childDecisions).toEqual([])
  await card.getByRole("button", { name: "Approve", exact: true }).click()
  await expect.poll(() => f.childDecisions).toEqual([{ request_id: "approval-1", approved: true }])
  await expect(card).toHaveCount(0)
  expect(f.writes).toEqual([])
  expect(f.observed.pageErrors).toEqual([])
})
