import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sid = "all-surface-session"
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const at = "2026-10-19T00:00:00Z"

async function imageFixture(page: Page) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, sid)
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  const session = { id: sid, title: "Synthetic image visibility", kind: "root", title_version: 1,
    root_session_id: sid, parent_session_id: null, spawn_depth: 0, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
    workspace_path: "/workspace/lotus-next", permission_mode: "default", bypass_permissions: false,
    is_running: false, last_run_status: "completed", subagent_count: 0,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64) }
  let history: unknown[] = []
  const attachments = new Map<string, string>()
  const requests: Array<{ message: string; images?: Array<{ base64: string; name: string; type: string }> }> = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(request.url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 } })
    if (path === `/api/v1/sessions/${sid}`) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    if (path === "/api/v1/chat" && request.method() === "POST") {
      requests.push(request.postDataJSON())
      const messageId = requests.length === 1 ? "accepted-image" : `accepted-image-${requests.length}`
      return route.fulfill({ json: { session_id: sid, message_id: messageId, ingress_seq: requests.length, status: "success" } })
    }
    if (path === `/api/v1/history/${sid}`) return route.fulfill({ json: { session_id: sid, messages: history } })
    const attachment = attachments.get(path)
    if (attachment) return route.fulfill({ body: Buffer.from(attachment, "base64"), contentType: "image/png" })
    if (path === `/api/v1/actors/${sid}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(sid, 0) })
    if (path === `/api/v1/task/${sid}`) return route.fulfill({ json: { session_id: sid, items: [] } })
    if (path === `/api/v1/respond/${sid}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    if (path === `/api/v1/execute/${sid}`) return route.fulfill({ json: { status: "started", session_id: sid } })
    return route.fallback()
  })
  const open = async () => {
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("heading", { name: session.title, exact: true })).toBeVisible()
  }
  const publish = (messages: Array<{ id: string; caption: string; data: string; assetId: string }>) => {
    history = messages.map(({ id, caption, data, assetId }) => {
      attachments.set(`/api/v1/sessions/${sid}/attachments/${assetId}`, data)
      return { id, role: "user", content: caption, content_parts: [
        { type: "text", text: caption }, { type: "image_url", image_url: { url: `bamboo-attachment://${sid}/${assetId}` } },
      ], created_at: at }
    })
  }
  return { open, publish, requests, runtime }
}

test("consecutive image acknowledgements keep distinct bubbles and preview sources until history catches up", async ({ page }) => {
  const { open, publish, requests, runtime } = await imageFixture(page)
  const channel = `agent.${sid}`
  let socket: WebSocketRoute | undefined
  let subscriptions = 0
  let sequence = 0
  await page.routeWebSocket(/\/v2\/stream(?:\?|$)/, (connection) => {
    socket = connection
    connection.onMessage((message) => {
      const frame = JSON.parse(String(message))
      if (frame.type === "hello") connection.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") connection.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === channel) subscriptions += 1
    })
  })
  const finish = () => socket!.send(JSON.stringify({ ch: channel, seq: ++sequence, event: { type: "complete", content: "" } }))
  await open()

  const first = { id: "accepted-image", name: "first.png", caption: "First pending caption", data: pixel, assetId: "image-1" }
  const second = { id: "accepted-image-2", name: "second.png", caption: "Second pending caption",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNI010NAAI7AT+/KVgqAAAAAElFTkSuQmCC", assetId: "image-2" }
  const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
  const pending = page.locator("[data-pending-user-message]")
  const send = async ({ name, data, caption }: typeof first) => {
    await input.fill(caption)
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: Buffer.from(data, "base64") })
    await expect(page.locator("[data-composer-region]").getByAltText(name, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Send message", exact: true }).click()
  }
  await send(first)
  await expect(pending).toHaveText(first.caption)
  await expect.poll(() => subscriptions).toBe(1)
  const stop = page.getByRole("button", { name: "Stop generation", exact: true })
  await expect(stop).toBeVisible()
  finish()
  await expect(stop).toHaveCount(0)

  await send(second)
  await expect(pending).toHaveText([first.caption, second.caption])
  await expect.poll(() => subscriptions).toBe(2)
  expect(new Set(await pending.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-pending-operation")))).size).toBe(2)
  expect(requests).toHaveLength(2)
  for (const [index, image] of [first, second].entries()) {
    expect(requests[index]).toMatchObject({ message: image.caption, images: [{ base64: image.data, name: image.name, type: "image/png" }] })
    const thumbnail = pending.nth(index).getByAltText(image.name, { exact: true })
    const src = `data:image/png;base64,${image.data}`
    await expect(thumbnail).toHaveAttribute("src", src)
    await thumbnail.click()
    await expect(page.getByRole("dialog", { name: "Close preview", exact: true }).locator("img")).toHaveAttribute("src", src)
    await page.getByRole("button", { name: "Close preview", exact: true }).click()
  }

  publish([first, second])
  finish()
  for (const image of [first, second]) {
    const restored = page.locator(`[data-message-row="${image.id}"] img`)
    await expect(restored).toBeVisible()
    await expect(restored).toHaveAttribute("src", `${standaloneScenario.origin}/api/v1/sessions/${sid}/attachments/${image.assetId}`)
  }
  await expect(pending).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(runtime.pageErrors).toEqual([])
})

for (const caption of ["", "Review the synthetic fixture"]) {
  test(`synthetic image remains visible after acknowledgement and restores from history: ${caption || "image only"}`, async ({ page }, info) => {
    const { open, publish, requests, runtime } = await imageFixture(page)
    await open()
    const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
    await expect(input).toBeVisible()
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from(pixel, "base64") })
    const composerImage = page.locator("[data-composer-region]").getByAltText("fixture.png", { exact: true })
    await expect(composerImage).toBeVisible()
    if (caption) await input.fill(caption)
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    const pending = page.locator("[data-pending-user-message]")
    await expect(pending.locator("img")).toBeVisible()
    await expect(pending.locator("img")).toHaveAttribute("src", `data:image/png;base64,${pixel}`)
    if (caption) await expect(pending).toContainText(caption)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ message: caption, images: [{ base64: pixel, name: "fixture.png", type: "image/png" }] })
    await expect(composerImage).toHaveCount(0)
    await pending.locator("img").click()
    await expect(page.getByRole("button", { name: "Close preview", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Close preview", exact: true }).click()
    await page.screenshot({ path: info.outputPath("synthetic-pending-image.png"), animations: "disabled" })

    publish([{ id: "accepted-image", caption, data: pixel, assetId: "image-1" }])
    await page.reload()
    const restored = page.locator('[data-message-row="accepted-image"] img')
    await expect(restored).toBeVisible()
    await expect(restored).toHaveAttribute("src", `${standaloneScenario.origin}/api/v1/sessions/${sid}/attachments/image-1`)
    await expect(page.locator("[data-pending-user-message]")).toHaveCount(0)
    expect(requests).toHaveLength(1)
    expect(runtime.pageErrors).toEqual([])
    await page.screenshot({ path: info.outputPath("synthetic-restored-image.png"), animations: "disabled" })
  })
}
