import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const running of [false, true]) {
  test(`composer Enter ${running ? "queues during an active run" : "sends an idle message"}, preserving newline and picker selection`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "physical keyboard regression")
    await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
    const observation = await installArtifactRuntime(page, standaloneScenario)
    const session = {
      id: "all-surface-session", title: "Keyboard acceptance", kind: "root",
      model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
      created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
      permission_mode: "default", is_running: running, last_run_status: running ? "running" : "completed",
    }
    await page.route("**/api/v1/sessions", (route) => route.fulfill({ json: { sessions: [session] } }))
    await page.route("**/api/v1/sessions/all-surface-session", (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
    await page.route("**/api/v1/task/all-surface-session", (route) => route.fulfill({ json: { session_id: session.id, items: [] } }))
    await page.route("**/api/v1/commands", (route) => route.fulfill({ json: { commands: [] } }))
    await page.route("**/api/v1/execute/all-surface-session", (route) => route.fulfill({ json: { status: "started", session_id: session.id } }))
    const requests: Array<{ message?: string; text?: string; mode?: string }> = []
    let acknowledge: () => void = () => {}
    const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve })
    await page.route(running ? "**/api/v1/sessions/all-surface-session/guidance" : "**/api/v1/chat", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fulfill({ json: { messages: [] } })
        return
      }
      const body = route.request().postDataJSON()
      requests.push(body)
      await acknowledgement
      await route.fulfill(running
        ? { status: 202, json: { id: body.id, activation_pending: false } }
        : { json: { session_id: session.id, status: "success" } })
    })
    await page.goto(standaloneScenario.entryUrl)
    const input = page.getByRole("textbox", { name: "消息", exact: true })
    await expect(input).toBeVisible()
    if (running) await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()

    // Enter chooses the highlighted built-in slash command before the composer sees it.
    await input.fill("/goal")
    await expect(page.getByRole("button", { name: /\/goal 指令/ })).toBeVisible()
    await input.press("Enter")
    await expect(input).toHaveValue("")
    expect(requests).toHaveLength(0)

    await input.press("Enter")
    await expect(input).toHaveValue("")
    expect(requests).toHaveLength(0)
    await input.fill("第一行")
    await input.press("Shift+Enter")
    await expect(input).toHaveValue("第一行\n")
    expect(requests).toHaveLength(0)
    await input.fill("第一行\n第二行")
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      await input.dispatchEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...composition })
    }
    await expect(input).toHaveValue("第一行\n第二行")
    expect(requests).toHaveLength(0)
    if (running) await page.getByRole("combobox", { name: "发送时机" }).selectOption("after_run")
    try {
      await input.press("Enter")
      await expect.poll(() => requests.length).toBe(1)
      expect(running ? requests[0].text : requests[0].message).toBe("第一行\n第二行")
      if (running) expect(requests[0].mode).toBe("after_run")
      await expect(input).toHaveAttribute("aria-busy", "true")
      await input.press("Enter")
      await input.press("Control+Enter")
      await expect(input).toHaveValue("第一行\n第二行")
      expect(requests).toHaveLength(1)
    } finally {
      acknowledge()
    }
    await expect(input).toHaveValue("")
    await expect(input).toHaveAttribute("aria-busy", "false")
    expect(requests).toHaveLength(1)
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  })
}
