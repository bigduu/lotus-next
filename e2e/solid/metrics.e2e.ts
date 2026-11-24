import { expect, test } from "@playwright/test"
import type {
  ForwardEndpointMetrics,
  ForwardRequestMetrics,
  MemoryTimelinePoint,
  MetricsUsageBreakdownResponse,
  ModelMetrics,
  SessionMetrics,
  UnifiedSummary,
  UnifiedTimelinePoint,
} from "../../src/services/metrics/types"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

test.use({ timezoneId: "UTC" })

function addDays(date: string, days: number) {
  const result = new Date(date + "T00:00:00Z")
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

const date = "2026-11-10"
const at = date + "T10:00:00Z"
const tokens = { prompt_tokens: 150, completion_tokens: 70, total_tokens: 220 }

function responses(range: string) {
  const title = `fixture-${range}`
  return {
    "v2/summary": {
      chat: {
        total_sessions: 3, total_tokens: tokens, total_tool_calls: 7, active_sessions: 1,
        total_tokens_saved: 22, total_compression_events: 2, completed_sessions: 2,
        sync_mismatch_breakdown: { message_count_mismatch: 2, custom_fixture_reason: 1 },
      },
      forward: { total_requests: 6, successful_requests: 5, failed_requests: 1, total_tokens: tokens },
      combined: { total_requests: 9, total_tokens: 440, total_success: 7, total_errors: 2, success_rate: 77.8 },
      memory: { total_memories: 5, stale_candidate_count: 1, project_count: 1, by_scope: {}, by_type: {}, by_status: {} },
    } satisfies UnifiedSummary,
    "v2/timeline": [
      { date, chat_tokens: 100, forward_tokens: 50, chat_sessions: 2, forward_requests: 3, total_tokens: 150 },
      { date: addDays(date, 1), chat_tokens: 120, forward_tokens: 170, chat_sessions: 1, forward_requests: 3, total_tokens: 290 },
    ] satisfies UnifiedTimelinePoint[],
    "by-model": Array.from({ length: 10 }, (_, index): ModelMetrics => ({
      model: `${title}-model-${index}`, tokens: { ...tokens, total_tokens: tokens.total_tokens - index },
      sessions: 1, rounds: 2, tool_calls: 3,
    })),
    "usage-breakdown": {
      total_sessions: 3, total_tool_calls: 7, core_tool_calls: 3, skill_load_calls: 2, mcp_calls: 2,
      unique_skills: 1, unique_mcp_servers: 1, unique_mcp_tools: 1,
      sessions_with_skill_loads: 1, sessions_with_mcp_calls: 1, top_core_tools: [{ name: `${title}-tool`, count: 3 }],
      top_skills: [{ skill_id: "fixture-skill", count: 2 }], top_mcp_servers: [],
      top_mcp_tools: [{ alias: "fixture-mcp-query", server_id: "fixture-server", tool_name: "fixture-query", count: 2 }],
    } satisfies MetricsUsageBreakdownResponse,
    sessions: [{
      session_id: "00000000-session-id", model: "fixture-session-model", status: "awaiting_response",
      started_at: at, total_rounds: 2, total_token_usage: tokens, tool_call_count: 3,
      tool_breakdown: {}, message_count: 2, duration_ms: 62_000,
    }] satisfies SessionMetrics[],
    "forward/by-endpoint": [{
      endpoint: "chat.completions", requests: 6, successful: 5, failed: 1, tokens, avg_duration_ms: 30_000,
    }] satisfies ForwardEndpointMetrics[],
    "forward/requests": [{
      forward_id: "11111111-forward-id", endpoint: "chat.completions", model: "fixture-forward-model", is_stream: true,
      started_at: at, status: "error", status_code: 429, error: "Synthetic request failure", duration_ms: 2400,
    }] satisfies ForwardRequestMetrics[],
    "memory/timeline": [{
      label: date, period_start: date, period_end: date, total_memories: 5, created_memories: 3, updated_memories: 1,
    }] satisfies MemoryTimelinePoint[],
  }
}

test("Solid Metrics uses the selected dates, keeps recent table bounds and ignores superseded reads", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  await page.clock.setFixedTime(new Date("2026-11-24T12:00:00Z"))
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
  })
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })

  const requests: { path: string; params: Record<string, string> }[] = []
  let denyUsage = false
  const stale = Promise.withResolvers<void>()
  await page.route("**/api/v1/metrics/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.slice("/api/v1/metrics/".length)
    if (path === "summary") return route.fallback()
    expect(route.request().method()).toBe("GET")
    const params = Object.fromEntries(url.searchParams)
    requests.push({ path, params })
    const { start_date: start, end_date: end } = params
    const range = !start ? "trend" : start === end ? "stale" : start === addDays(end, -29) ? "month" : start === date ? "custom" : "initial"
    if (range === "stale" && path === "v2/summary") await stale.promise
    if (range === "month" && path === "usage-breakdown" && denyUsage) {
      return route.fulfill({ status: 403, json: { message: "Synthetic usage forbidden" } })
    }
    const data = responses(range)
    expect(Object.hasOwn(data, path)).toBe(true)
    return route.fulfill({ json: data[path as keyof typeof data] })
  })

  try {
    await page.goto(entryUrl)
    if (isMobile) await page.getByRole("button", { name: "Menu", exact: true }).click()
    await page.getByRole("button", { name: "System Settings", exact: true }).click()
    const settings = page.locator('[data-slot="settings-page"]')
    if (isMobile) await settings.getByRole("combobox", { name: "System Settings", exact: true }).selectOption("metrics")
    else await settings.getByRole("button", { name: "Metrics", exact: true }).click()

    const metrics = settings.getByRole("region", { name: "Metrics", exact: true })
    const start = metrics.getByLabel("Start date", { exact: true })
    const end = metrics.getByLabel("End date", { exact: true })
    const selectedEnd = await end.inputValue()
    const selectedStart = addDays(selectedEnd, -6)
    const region = (name: string) => metrics.getByRole("region", { name, exact: true })
    const button = (name: string) => metrics.getByRole("button", { name, exact: true })
    await expect(start).toHaveValue(selectedStart)
    await expect(metrics.getByText("fixture-initial-model-0", { exact: false })).toBeVisible()
    const dated = { start_date: selectedStart, end_date: selectedEnd }
    expect(requests).toHaveLength(8)
    expect(requests).toEqual(expect.arrayContaining([
      { path: "v2/summary", params: dated },
      { path: "v2/timeline", params: { days: "7", end_date: selectedEnd } },
      { path: "by-model", params: dated },
      { path: "usage-breakdown", params: dated },
      { path: "sessions", params: { ...dated, limit: "20" } },
      { path: "forward/by-endpoint", params: dated },
      { path: "forward/requests", params: { ...dated, limit: "50" } },
      { path: "memory/timeline", params: { days: "7", end_date: selectedEnd } },
    ]))
    await expect(region("Overview")).toContainText("Compression events 2")
    await expect(region("Model distribution (by tokens)")).toContainText("Other (2 models)")
    await expect(region("Sync mismatch distribution (by reason)")).toContainText("Message count")
    await expect(region("Sync mismatch distribution (by reason)")).toContainText("Custom Fixture Reason")
    await expect(region("Recent sessions (up to 20)").getByRole("row").last()).toContainText("Awaiting response")
    await expect(region("Recent Forward requests (up to 50)").getByRole("row").last()).toContainText("Synthetic request failure")

    const tokenTrend = region("Token trend (last 7 days)")
    const chart = tokenTrend.getByRole("img", { name: "Token trend chart", exact: true })
    await expect(chart).toBeVisible()
    await chart.focus()
    await chart.press("ArrowLeft")
    await expect(tokenTrend.getByText("2 Sessions · 3 Forward requests", { exact: true })).toBeVisible()
    await tokenTrend.getByRole("button", { name: "Table", exact: true }).click()
    await expect(tokenTrend.getByRole("row").nth(1).getByRole("cell")).toHaveText([date, "100", "50", "2", "3"])
    const memoryTrend = region("Memory trend (last 7 days)")
    await expect(memoryTrend.getByRole("img", { name: "Memory trend chart", exact: true })).toBeVisible()
    await memoryTrend.getByRole("button", { name: "Table", exact: true }).click()
    await expect(memoryTrend.getByRole("row").nth(1).getByRole("cell")).toHaveText([date, "5", "3", "1"])

    await button("Today").click()
    await expect.poll(() => requests.filter(({ path, params }) =>
      path === "v2/summary" && params.start_date === params.end_date).length).toBe(1)
    denyUsage = true
    await button("30 days").click()
    await expect(metrics.getByText("fixture-month-model-0", { exact: false })).toBeVisible()
    await expect(metrics.getByRole("alert")).toContainText("Synthetic usage forbidden")
    await expect(region("Usage breakdown")).toContainText("fixture-initial-tool")

    const late = page.waitForResponse((response) => {
      const request = new URL(response.url())
      return request.pathname.endsWith("/v2/summary") && request.searchParams.get("start_date") === selectedEnd
    })
    stale.resolve()
    await (await late).finished()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(metrics.getByText("fixture-stale-model-0", { exact: false })).toHaveCount(0)
    await expect(metrics.getByRole("alert")).toContainText("Synthetic usage forbidden")

    denyUsage = false
    await button("Retry").click()
    await expect(metrics.getByRole("alert")).toHaveCount(0)
    await expect(region("Usage breakdown")).toContainText("fixture-month-tool")

    await start.fill(date)
    await expect(metrics.getByText("fixture-custom-model-0", { exact: false })).toBeVisible()
    await end.fill(addDays(date, 4))
    await expect.poll(() => requests.some(({ path, params }) =>
      path === "memory/timeline" && params.days === "5" && params.end_date === addDays(date, 4))).toBe(true)
    await expect(region("Token trend (last 5 days)").getByRole("table")).toBeVisible()
    expect(observed.pageErrors).toEqual([])
  } finally {
    stale.resolve()
  }
})
