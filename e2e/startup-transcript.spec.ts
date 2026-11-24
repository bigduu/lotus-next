import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const lastMessageKey = "message-latest-63"
const history = Array.from({ length: 64 }, (_, index) => {
  const user = index % 2 === 0
  const title = `latest fixture message ${index}`
  const size = [0, 0, 1, 0, 2, 0, 7, 0, 2, 0, 0, 0, 4][index % 13]!
  const content = user || size === 0 ? title : [
    `### ${title}`,
    "This is a saved release note with a **bolded observation** that wraps more than once in a compact desktop viewport. ".repeat(size),
    "- one detail\n- another detail",
    "```js\n" + "const value = 'one synthetic line';\n".repeat(size * 3) + "```",
    "Last paragraph",
  ].join("\n\n")
  return { id: `latest-${index}`, role: user ? "user" : "assistant", content, created_at: "2026-09-03T00:00:00.000Z" }
})

type StartupFrame = { gap: number; latestInset: number | null; fallback: boolean }
declare global {
  interface Window {
    startupTranscriptTrace: { frames: StartupFrame[]; ticks: number }
  }
}

test.use({ viewport: { width: 1280, height: 800 } })
test.skip(({ hasTouch }) => hasTouch, "Bodhi desktop transcript")

test("restored history shows the latest message from its first visible frame", async ({ page }) => {
  await page.addInitScript(({ sessionId, lastMessageKey }) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", sessionId)
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    const trace = { frames: [] as StartupFrame[], ticks: 0 }
    window.startupTranscriptTrace = trace
    const sample = () => {
      trace.ticks += 1
      const viewport = document.querySelector<HTMLElement>("[data-chat-body] [data-history-viewport]")
      if (viewport) {
        const rows = Array.from(viewport.querySelectorAll<HTMLElement>("[data-history-entry-key]"))
        const bounds = viewport.getBoundingClientRect()
        const visible = rows.filter((row) => {
          const box = row.getBoundingClientRect()
          return box.bottom > bounds.top && box.top < bounds.bottom && getComputedStyle(row).visibility === "visible"
        })
        if (visible.length || (trace.frames.length && getComputedStyle(viewport).visibility === "visible")) {
          const latest = visible.find((row) => row.dataset.historyEntryKey === lastMessageKey)
          trace.frames.push({
            gap: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
            latestInset: latest ? bounds.bottom - latest.getBoundingClientRect().bottom : null,
            fallback: visible.some((row) => !!row.querySelector("[data-assistant-markdown-fallback]")),
          })
        }
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, { sessionId, lastMessageKey })

  const observation = await installArtifactRuntime(page, standaloneScenario, history)
  let requestedMarkdown = false
  let releaseMarkdown!: () => void
  const markdown = new Promise<void>((resolve) => { releaseMarkdown = resolve })
  await page.route(/\/assets\/AssistantMarkdown-[^/]+\.js$/, async (route) => {
    requestedMarkdown = true
    await markdown
    await route.fallback()
  })
  const getTrace = () => page.evaluate(() => window.startupTranscriptTrace)
  const waitForFrames = async (count: number) => {
    const target = (await getTrace()).ticks + count
    await page.waitForFunction((tick) => window.startupTranscriptTrace.ticks >= tick, target)
  }

  try {
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
    await expect.poll(() => requestedMarkdown).toBe(true)
    await waitForFrames(6)
  } finally {
    releaseMarkdown()
  }

  const viewport = page.locator("[data-chat-body] [data-history-viewport]")
  const latest = viewport.locator(`[data-history-entry-key="${lastMessageKey}"]`)
  await expect(latest).toBeVisible()
  await expect(latest).toBeInViewport()
  await expect(viewport.locator("[data-solid-code-token]").first()).toBeAttached()
  await waitForFrames(4)

  const { frames } = await getTrace()
  expect(frames.length).toBeGreaterThan(0)
  const latestInset = frames.at(-1)!.latestInset!
  expect(frames.filter((frame) => frame.gap > 2 || frame.latestInset === null ||
    Math.abs(frame.latestInset - latestInset) > 2 || frame.fallback)).toEqual([])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
