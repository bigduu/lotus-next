import { expect, test } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sid = "all-surface-session"
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const at = "2026-10-19T00:00:00Z"

for (const caption of ["", "Review the synthetic fixture"]) {
  test(`synthetic image remains visible after acknowledgement and restores from history: ${caption || "image only"}`, async ({ page }, info) => {
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
    let persisted = false
    const requests: Array<{ message: string; images?: Array<{ base64: string; name: string; type: string }> }> = []
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(request.url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 } })
      if (path === `/api/v1/sessions/${sid}`) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
      if (path === "/api/v1/chat" && request.method() === "POST") {
        requests.push(request.postDataJSON())
        return route.fulfill({ json: { session_id: sid, message_id: "accepted-image", ingress_seq: 1, status: "success" } })
      }
      if (path === `/api/v1/history/${sid}`) return route.fulfill({ json: { session_id: sid, messages: persisted ? [
        { id: "accepted-image", role: "user", content: caption, content_parts: [
          { type: "text", text: caption }, { type: "image_url", image_url: { url: `bamboo-attachment://${sid}/image-1` } },
        ], created_at: at },
      ] : [] } })
      if (path === `/api/v1/sessions/${sid}/attachments/image-1`) return route.fulfill({ body: Buffer.from(pixel, "base64"), contentType: "image/png" })
      if (path === `/api/v1/actors/${sid}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(sid, 0) })
      if (path === `/api/v1/task/${sid}`) return route.fulfill({ json: { session_id: sid, items: [] } })
      if (path === `/api/v1/respond/${sid}/pending`) return route.fulfill({ json: { has_pending_question: false } })
      if (path === `/api/v1/execute/${sid}`) return route.fulfill({ json: { status: "started", session_id: sid } })
      return route.fallback()
    })
    await page.goto(standaloneScenario.entryUrl)
    const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
    await expect(input).toBeVisible()
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from(pixel, "base64") })
    await expect(page.getByAltText("fixture.png", { exact: true })).toBeVisible()
    if (caption) await input.fill(caption)
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    const pending = page.locator("[data-pending-user-message]")
    await expect(pending.locator("img")).toBeVisible()
    await expect(pending.locator("img")).toHaveAttribute("src", `data:image/png;base64,${pixel}`)
    if (caption) await expect(pending).toContainText(caption)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ message: caption, images: [{ base64: pixel, name: "fixture.png", type: "image/png" }] })
    await expect(page.getByAltText("fixture.png", { exact: true })).toHaveCount(0)
    await pending.locator("img").click()
    await expect(page.getByRole("button", { name: "Close preview", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Close preview", exact: true }).click()
    await page.screenshot({ path: info.outputPath("synthetic-pending-image.png"), animations: "disabled" })

    persisted = true
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
