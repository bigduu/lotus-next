import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// These responses are synthetic v1 contract fixtures, not captured user data or
// evidence of a real Bamboo/OTel round trip.
const sessionId = "all-surface-session", traceId = "a".repeat(32), rootId = "b".repeat(16)
const base = "2026-10-29T10:00:00.000Z"
const list = { schema_version: 1, session_id: sessionId, collection_state: "enabled", next_cursor: null,
  retention: { max_spans: 2048, evicted_spans: 3 }, traces: [{ trace_id: traceId, started_at: base,
    ended_at: "2026-10-29T10:00:02.400Z", status: "success", span_count: 3, partial: false }] }
const detail = { schema_version: 1, session_id: sessionId, trace: { trace_id: traceId, partial: false, spans: [
  { span_id: rootId, parent_span_id: null, kind: "agent", started_at: base, ended_at: "2026-10-29T10:00:02.400Z",
    status: "success", model: null, provider: null, usage: null },
  { span_id: "c".repeat(16), parent_span_id: rootId, kind: "llm", started_at: "2026-10-29T10:00:00.150Z",
    ended_at: "2026-10-29T10:00:01.800Z", status: "success", model: "fixture-model", provider: "openai",
    usage: { input_tokens: 1250, output_tokens: null, reasoning_tokens: null, cache_read_input_tokens: 0,
      cache_creation_input_tokens: null, cache_write_input_tokens: 24 }, prompt: "PROMPT_SENTINEL" },
  { span_id: "d".repeat(16), parent_span_id: rootId, kind: "tool", started_at: "2026-10-29T10:00:01.850Z",
    ended_at: "2026-10-29T10:00:02.200Z", status: "success", model: null, provider: null, usage: null,
    tool_body: "TOOL_BODY_SENTINEL" },
] } }

test("session trace panel renders synthetic v1 data safely at the current viewport", async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const traceRequests: string[] = []
  await page.route(`**/api/v1/sessions/${sessionId}/traces**`, (route) => {
    const url = new URL(route.request().url())
    traceRequests.push(url.pathname + url.search)
    return route.fulfill({ json: url.pathname.endsWith(`/traces/${traceId}`) ? detail : list })
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Local traces", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Local traces", exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("region", { name: "Span timeline" })).toBeVisible()
  await dialog.getByRole("button", { name: /Model call/ }).click()
  const details = dialog.getByRole("region", { name: "Span details" })
  await expect(details).toContainText("fixture-model")
  await expect(details).toContainText("1,250")
  await expect(details).toContainText("Cache read0")
  await expect(details).toContainText("Cache creationUnknown")
  await expect(details).toContainText("Cache write24")
  await expect(dialog).not.toContainText("PROMPT_SENTINEL")
  await expect(dialog).not.toContainText("TOOL_BODY_SENTINEL")
  const dimensions = await dialog.evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1)
  // The screenshots remain recognizably synthetic when detached from the test report.
  await page.locator("body").evaluate((body) => {
    const badge = body.ownerDocument.createElement("div")
    badge.textContent = "Synthetic fixture — not real telemetry"
    Object.assign(badge.style, { position: "fixed", zIndex: "9999", top: "4px", left: "50%", transform: "translateX(-50%)",
      background: "#fef3c7", color: "#422006", padding: "4px 10px", borderRadius: "6px", font: "600 11px system-ui", whiteSpace: "nowrap" })
    body.appendChild(badge)
  })
  await page.screenshot({ path: info.outputPath("synthetic-local-traces.png"), animations: "disabled" })
  if ((page.viewportSize()?.width ?? 0) < 600) {
    await details.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath("synthetic-local-traces-detail.png"), animations: "disabled" })
  }
  expect(traceRequests).toEqual([
    `/api/v1/sessions/${sessionId}/traces?limit=50`, `/api/v1/sessions/${sessionId}/traces/${traceId}`,
  ])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
