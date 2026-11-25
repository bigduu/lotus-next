import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`only a fresh model title plays the arrival motion (${reducedMotion})`, async ({ page, baseURL }) => {
    const id = "all-surface-session"
    const timestamp = "2026-09-07T00:00:00Z"
    const session = {
      id, title: "New Session", title_version: 0, title_generated: false,
      kind: "root", root_session_id: id, parent_session_id: null,
      model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
      created_at: timestamp, updated_at: timestamp, message_count: 1, is_running: false,
      last_run_status: "completed", permission_mode: "default",
    }
    await page.emulateMedia({ reducedMotion })
    await page.addInitScript((sessionId) => {
      localStorage.setItem("lotus_next_last_session", sessionId)
      localStorage.setItem("bodhi_onboarded_v1", "1")
      const entries: string[] = []
      Object.defineProperty(window, "fixtureTitleArrivals", { value: entries })
      document.addEventListener("animationstart", (event) => {
        if (event.animationName === "session-title-arrival"
            && event.target instanceof Element
            && event.target.closest("[data-session-title]")) {
          entries.push(event.target.textContent ?? "")
        }
      })
    }, id)
    const entryUrl = new URL("/", baseURL).href
    const observation = await installArtifactRuntime(page, {
      ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
    }, [{ id: "user-1", role: "user", content: "https://example.test/change\n看一下", created_at: timestamp }], {
      serveStaticFromLocalServer: true,
    })
    const apiSessions = "**/api/v1/sessions"
    await page.route(`${apiSessions}?*`, (route) => {
      const sessions = new URL(route.request().url()).searchParams.get("kind") === "child" ? [] : [session]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    })
    await page.route(`${apiSessions}/${id}`, (route) => route.fulfill({
      json: { session }, headers: { ETag: `"${session.title_version}"` },
    }))
    let feed: WebSocketRoute | undefined
    await page.routeWebSocket("**/v2/stream", (socket) => {
      socket.onMessage((raw) => {
        const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
        if (frame.type === "hello") socket.send(JSON.stringify({ type: "welcome" }))
        if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong" }))
        if (frame.type === "subscribe" && frame.ch === "feed") feed = socket
      })
    })
    const send = (seq: number, version: number, title: string, live: boolean, source = "auto") => {
      feed!.send(JSON.stringify({
        ch: "feed", seq, ...(live ? { delivery: "live" } : {}),
        event: { seq, ts: timestamp, session_id: id, event: {
          type: "session_title_updated", session_id: id, title, title_version: version,
          title_generated: true, source, updated_at: timestamp,
        } },
      }))
    }
    const arrivals = () => page.evaluate(() => {
      const tracked = window as typeof window & { fixtureTitleArrivals?: string[] }
      return tracked.fixtureTitleArrivals ?? []
    })
    const afterPaint = () => page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

    await page.goto(entryUrl)
    const heading = page.getByRole("banner").getByRole("heading")
    await expect(heading).toHaveText("New Session")
    await expect.poll(() => feed !== undefined).toBe(true)
    expect(await arrivals()).toEqual([])
    const oldHeight = await heading.evaluate((element) => element.getBoundingClientRect().height)
    const generatedTitle = "查看 Lotus 模型选择器改动"
    Object.assign(session, { title: generatedTitle, title_version: 1, title_generated: true })
    send(1, 1, generatedTitle, true)
    await expect(heading).toHaveText(generatedTitle)
    expect(await heading.evaluate((element) => element.getBoundingClientRect().height)).toBe(oldHeight)
    if (reducedMotion === "no-preference") {
      await expect.poll(arrivals).toContain(generatedTitle)
    }
    await afterPaint()
    const initialArrivals = await arrivals()
    if (reducedMotion === "reduce") expect(initialArrivals).toEqual([])

    // A duplicate version, a newer replay and a live manual rename render silently.
    send(2, 1, generatedTitle, true)
    const replayedTitle = "查看 Lotus 模型选择器和移动端滚动"
    Object.assign(session, { title: replayedTitle, title_version: 2 })
    send(3, 2, replayedTitle, false)
    await expect(heading).toHaveText(replayedTitle)
    await afterPaint()
    expect(await arrivals()).toEqual(initialArrivals)

    const manualTitle = "手动命名的会话"
    Object.assign(session, { title: manualTitle, title_version: 3 })
    send(4, 3, manualTitle, true, "manual")
    await expect(heading).toHaveText(manualTitle)
    await afterPaint()
    expect(await arrivals()).toEqual(initialArrivals)

    await page.reload()
    await expect(heading).toHaveText(manualTitle)
    await afterPaint()
    expect(await arrivals()).toEqual([])
    expect(observation.pageErrors).toEqual([])
  })
}
