import { expect, test } from "@playwright/test"
import type { HistoryResponse } from "../../src/services/chat/AgentService"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const sessionId = "all-surface-session"
const otherId = "other-review"
const createdAt = "2026-11-23T00:00:00Z"
const file = "/fixture/src/prefix.ts"
const cursorAt = (offset: number) => `prefix/${offset}`

function makeSession(id: string, title: string, count: number) {
  return {
    id, title, title_version: 1, kind: "root", root_session_id: id,
    workspace_path: "/fixture", pinned: false, is_running: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: createdAt, updated_at: createdAt, message_count: count, subagent_count: 0,
    permission_mode: "default", root_orchestration_only: false, thinking_mode: "standard",
    root_mode_transition_epoch: 0, root_mode_birth_token: (id === sessionId ? "a" : "b").repeat(64),
  }
}

type HistoryMessage = HistoryResponse["messages"][number]

function edit(label: string, path = file): HistoryMessage[] {
  const id = `edit-${label}`
  return [{
    id: id + "-call", role: "assistant", content: "", created_at: createdAt,
    tool_calls: [{ id, type: "function", function: { name: "Edit", arguments: "{}" } }],
  }, {
    id: id + "-result", role: "tool", tool_call_id: id, created_at: createdAt, tool_success: true,
    content: JSON.stringify({
      operation: "Edit", file_path: path,
      diff: { unified: `--- a/file\n+++ b/file\n@@ -0,0 +1 @@\n+${label}`, added_lines: 1, removed_lines: 0 },
    }),
  }]
}

test("Solid Review loads ordered earlier edits without expanding chat and discards an abandoned prefix", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, entryUrl, origin: new URL(entryUrl).origin,
  }, [], { serveStaticFromLocalServer: true })

  const transcript = Array.from({ length: 204 }, (_, index): HistoryMessage => ({
    id: `message-${index}`, role: "user", created_at: createdAt,
    content: index === 203 ? "Latest message in the long chat" : `Private old context ${index}`,
  }))
  transcript.splice(1, 2, ...edit("oldest change"))
  transcript.splice(51, 2, ...edit("middle change"))
  transcript.splice(110, 2, ...edit("recent change"))
  const otherHistory = [...edit("sibling change", "/fixture/other.ts"), {
    id: "sibling-message", role: "user", created_at: createdAt, content: "Independent chat",
  }]
  const sessions = [
    makeSession(sessionId, "Long transcript", transcript.length),
    makeSession(otherId, "Other transcript", otherHistory.length),
  ]

  const held = Promise.withResolvers<void>()
  const earlier: { before: string; limit: string | null }[] = []
  let recentPreference: string | undefined
  const abandoned: string[] = []
  page.on("requestfailed", (request) => {
    const url = new URL(request.url())
    if (url.pathname === `/api/v1/history/${sessionId}`) {
      const cursor = url.searchParams.get("before_message_id")
      if (cursor) abandoned.push(cursor)
    }
  })

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== "GET") return route.fallback()
    if (url.pathname === "/api/v1/sessions") {
      const listed = url.searchParams.get("kind") === "root" ? sessions : []
      return route.fulfill({ json: { sessions: listed, total: listed.length, limit: 200, offset: 0 } })
    }
    const session = sessions.find((session) => url.pathname.endsWith("/" + session.id))
    if (!session) return route.fallback()
    if (url.pathname.startsWith("/api/v1/sessions/")) {
      return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    }
    if (url.pathname.startsWith("/api/v1/task/")) return route.fulfill({ json: { session_id: session.id, items: [] } })
    if (!url.pathname.startsWith("/api/v1/history/")) return route.fallback()
    if (session.id === otherId) return route.fulfill({ json: { session_id: otherId, messages: otherHistory } })

    const before = url.searchParams.get("before_message_id")
    if (before) {
      earlier.push({ before, limit: url.searchParams.get("limit") })
      if (earlier.length === 1) await held.promise
    } else {
      recentPreference = route.request().headers().accept
    }
    const end = before ? Number(before.split("/")[1]) : transcript.length
    const start = Math.max(0, end - 100)
    return route.fulfill({ json: {
      session_id: sessionId, messages: transcript.slice(start, end), is_delta: false,
      total_message_count: transcript.length, history_start_index: start,
      next_before_message_id: start ? cursorAt(start) : null,
    } })
  })

  try {
    const button = (name: string) => page.getByRole("button", { name, exact: true })
    const workbench = page.locator("#right-workbench")
    const openReview = async () => {
      if (!await workbench.isVisible()) await button("Open side panel").click()
      const tab = workbench.getByRole("tab", { name: "Review", exact: true })
      if (await tab.isVisible()) await tab.click()
      else {
        await workbench.getByRole("button", { name: "Open workbench tab", exact: true }).click()
        await page.getByRole("menuitem", { name: "Review", exact: true }).click()
      }
      await expect(tab).toHaveAttribute("aria-selected", "true")
    }
    const review = workbench.getByRole("tabpanel", { name: "Review", exact: true })
    await page.goto(entryUrl)
    await expect(page.getByText("Latest message in the long chat", { exact: true })).toBeVisible()
    expect(recentPreference).toBe("application/json; bamboo-history-limit=100")
    expect(earlier).toEqual([])
    await openReview()
    await expect(review.getByRole("status")).toContainText("Loading earlier conversation history")
    await expect(review.getByText("1 file · 1 change", { exact: true })).toBeVisible()
    await expect.poll(() => earlier).toEqual([{ before: cursorAt(104), limit: "100" }])

    if (isMobile) {
      await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click()
      await button("Menu").click()
    }
    await button("Other transcript").click()
    await expect(page.getByRole("heading", { name: "Other transcript", exact: true })).toBeVisible()
    await expect.poll(() => abandoned).toContain(cursorAt(104))
    held.resolve()
    await openReview()
    await expect(review.getByText("other.ts", { exact: true })).toBeVisible()
    expect(earlier).toEqual([{ before: cursorAt(104), limit: "100" }])

    if (isMobile) {
      await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click()
      await button("Menu").click()
    }
    await button("Long transcript").click()
    await expect(page.getByRole("heading", { name: "Long transcript", exact: true })).toBeVisible()
    await openReview()
    await expect(review.getByText("1 file · 3 changes", { exact: true })).toBeVisible()
    await expect(review.getByRole("row", { name: /^\+(?:oldest|middle|recent) change$/ })).toHaveText([
      "+oldest change", "+middle change", "+recent change",
    ])
    expect(earlier).toEqual([
      { before: cursorAt(104), limit: "100" },
      { before: cursorAt(104), limit: "100" },
      { before: cursorAt(4), limit: "100" },
    ])
    await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click()
    await expect(workbench).toBeHidden()
    await expect(page.getByText("Latest message in the long chat", { exact: true })).toBeVisible()
    await expect(page.getByText("Private old context 0", { exact: true })).toHaveCount(0)
    await expect(button("Load earlier messages")).toHaveCount(1)
    expect(observed.pageErrors).toEqual([])
  } finally {
    held.resolve()
  }
})
