import { expect, test, type Locator, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { composerText, expectComposerText } from "./support/composer.js"

const mainId = "all-surface-session"
const sideId = "composer-other-session"
const workspace = "/workspace/lotus-next"
const at = "2026-10-06T00:00:00.000Z"
const filePaths = ["README.md", "src/alpha.ts", "docs/设计 文档@v2.md", "packages/@scope/a b.ts"]
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
type ChatRequest = { session_id?: string; message: string; images?: Array<{ base64: string; name: string; type: string }> }

async function openComposer(page: Page) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, mainId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const sessions = [mainId, sideId].map((id, index) => ({
    id, title: index ? "Other composer draft" : "Composer editor acceptance", kind: "root", title_version: 1,
    root_session_id: id, parent_session_id: null, spawn_depth: 0, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
    workspace_path: workspace, permission_mode: "default", bypass_permissions: false,
    is_running: false, last_run_status: "completed", subagent_count: 0,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64),
  }))
  const chats: ChatRequest[] = []
  const workspaceReads: unknown[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === "/api/v1/sessions") {
      const visible = url.searchParams.get("kind") === "child" ? [] : sessions
      return route.fulfill({ json: { sessions: visible, total: visible.length, limit: 200, offset: 0 } })
    }
    if (path === "/api/v1/workspace/files") {
      workspaceReads.push(request.postDataJSON())
      return route.fulfill({ json: filePaths.map((path) => ({ path, name: path.split("/").at(-1), is_directory: false })) })
    }
    if (path === "/api/v1/chat" && request.method() === "POST") {
      chats.push(request.postDataJSON() as ChatRequest)
      return route.fulfill({ json: { session_id: mainId, status: "success" } })
    }
    for (const session of sessions) {
      if (path === `/api/v1/sessions/${session.id}`) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
      if (path === `/api/v1/history/${session.id}`) return route.fulfill({ json: { session_id: session.id, messages: [] } })
      if (path === `/api/v1/task/${session.id}`) return route.fulfill({ json: { session_id: session.id, items: [] } })
      if (path === `/api/v1/respond/${session.id}/pending`) return route.fulfill({ json: { has_pending_question: false } })
      if (path === `/api/v1/execute/${session.id}`) return route.fulfill({ json: { status: "started", session_id: session.id } })
      if (path === `/api/v1/actors/${session.id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(session.id, 0) })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await page.keyboard.press("Escape")
  const editor = page.getByRole("textbox", { name: "Messages", exact: true }).first()
  await expect(editor).toBeVisible()
  await expect(editor).toHaveAttribute("contenteditable", "true")
  await expect(editor).toHaveAttribute("aria-multiline", "true")
  await expect(editor).toHaveAttribute("data-composer-editor")
  return { editor, chats, observation, workspaceReads }
}

async function pasteText(editor: Locator, plain: string, html?: string) {
  await editor.focus()
  await editor.evaluate((element, data) => {
    const browser = element.ownerDocument.defaultView!
    const clipboardData = new browser.DataTransfer()
    clipboardData.setData("text/plain", data.plain)
    if (data.html) clipboardData.setData("text/html", data.html)
    element.dispatchEvent(new browser.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
  }, { plain, html })
}

async function chooseFile(page: Page, editor: Locator, query: string, path: string) {
  await editor.pressSequentially(`@${query}`)
  await page.getByRole("option", { name: path, exact: true }).click()
  const mention = editor.locator('[data-type="mention"]')
  await expect(mention).toHaveText(`@${path}`)
  await expect(mention).toHaveAttribute("contenteditable", "false")
  await expect(editor).toBeFocused()
  return mention
}

async function selectSession(page: Page, title: string) {
  const row = page.getByRole("button", { name: title, exact: true })
  const box = await row.boundingBox()
  if (!box || box.x < 0 || box.x + box.width > page.viewportSize()!.width) {
    await page.getByRole("button", { name: "Menu", exact: true }).click()
  }
  await row.click()
}

test("file suggestions expose keyboard selection without submitting or stealing focus", async ({ page }) => {
  const { editor, chats, observation, workspaceReads } = await openComposer(page)
  await editor.pressSequentially("@")
  const list = page.getByRole("listbox")
  const options = list.getByRole("option")
  await expect(options).toHaveCount(filePaths.length)
  await expect(editor).toHaveAttribute("aria-controls", await list.getAttribute("id") as string)
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")
  await editor.press("ArrowDown")
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true")
  await expect(editor).toHaveAttribute("aria-activedescendant", await options.nth(1).getAttribute("id") as string)
  await editor.press("Enter")
  await expect(editor.locator('[data-type="mention"]')).toHaveText("@src/alpha.ts")
  await expectComposerText(editor, "@src/alpha.ts ")
  await expect(list).toHaveCount(0)
  await expect(editor).toBeFocused()
  expect(chats).toHaveLength(0)
  expect(workspaceReads).toEqual([{ path: workspace, max_depth: 3, max_entries: 500, include_hidden: false }])

  await editor.fill("@read")
  await expect(page.getByRole("option", { name: "README.md", exact: true })).toBeVisible()
  await editor.press("Escape")
  await expect(list).toHaveCount(0)
  await expectComposerText(editor, "@read")
  expect(chats).toHaveLength(0)
  await editor.pressSequentially("m")
  await expect(page.getByRole("option", { name: "README.md", exact: true })).toBeVisible()
  await editor.press("Tab")
  await expectComposerText(editor, "@README.md ")
  expect(chats).toHaveLength(0)
  await editor.pressSequentially("please")
  await editor.press("Enter")
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0].message).toBe("@README.md please")
  await expectComposerText(editor, "")
  expect(observation.pageErrors).toEqual([])
})

for (const [query, path] of [["read", "README.md"], ["docs", "docs/设计 文档@v2.md"], ["packages", "packages/@scope/a b.ts"]]) {
  test(`a file picked in the middle of a sentence submits its exact path: ${path}`, async ({ page }) => {
    const { editor, chats, observation } = await openComposer(page)
    await editor.fill("Before  after")
    await editor.press("Control+Home")
    for (let index = 0; index < "Before ".length; index += 1) await editor.press("ArrowRight")
    await chooseFile(page, editor, query, path)
    await expectComposerText(editor, `Before @${path} after`)
    expect(chats).toHaveLength(0)
    await editor.press("Enter")
    await expect.poll(() => chats.length).toBe(1)
    expect(chats[0].message).toBe(`Before @${path} after`)
    expect(chats[0].message).not.toMatch(/<span|data-type|\[.*\]\(/)
    expect(observation.pageErrors).toEqual([])
  })
}

for (const direction of ["Backspace", "Delete"]) {
  test(`a mention deletes as one atom with ${direction}`, async ({ page }) => {
    const { editor, chats } = await openComposer(page)
    await editor.fill("Review ")
    await chooseFile(page, editor, "docs", "docs/设计 文档@v2.md")
    if (direction === "Backspace") {
      await editor.press("End")
      await editor.press("Backspace") // The insertion's trailing space.
      await expect(editor.locator('[data-type="mention"]')).toHaveCount(1)
    } else {
      await editor.press("Control+Home")
      for (let index = 0; index < "Review ".length; index += 1) await editor.press("ArrowRight")
    }
    await editor.press(direction)
    await expect(editor.locator('[data-type="mention"]')).toHaveCount(0)
    await expectComposerText(editor, direction === "Backspace" ? "Review " : "Review  ")
    await expect(page.getByRole("listbox")).toHaveCount(0)
    expect(chats).toHaveLength(0)
    await editor.pressSequentially("done")
    await editor.press("Enter")
    await expect.poll(() => chats.length).toBe(1)
    expect(chats[0].message).toBe("Review done")
  })
}

test("typed HTTP links stay editable and clicking never navigates away", async ({ page }) => {
  const { editor, chats, observation } = await openComposer(page)
  const originalUrl = page.url()
  const originalPages = page.context().pages().length
  await editor.pressSequentially("See https://example.test/guide and http://example.test/help ")
  const links = editor.locator("a")
  await expect(links).toHaveCount(2)
  await expect(links.nth(0)).toHaveAttribute("href", "https://example.test/guide")
  await expect(links.nth(1)).toHaveAttribute("href", "http://example.test/help")
  await links.nth(0).click()
  expect(page.url()).toBe(originalUrl)
  expect(page.context().pages()).toHaveLength(originalPages)
  await editor.press("Control+End")
  await editor.pressSequentially("then reply")
  await editor.press("Enter")
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0].message).toBe("See https://example.test/guide and http://example.test/help then reply")
  expect(observation.httpRequests.some(({ url }) => url.startsWith("https://example.test/"))).toBe(false)
  expect(observation.pageErrors).toEqual([])
})

test("inline references and links fit the composer at every supported viewport", async ({ page }, testInfo) => {
  const { editor } = await openComposer(page)
  await editor.fill("Review ")
  await chooseFile(page, editor, "docs", "docs/设计 文档@v2.md")
  await pasteText(editor, "with https://example.test/guide")
  await expectComposerText(editor, "Review @docs/设计 文档@v2.md with https://example.test/guide")
  await expect(editor.locator('[data-type="mention"]')).toHaveCount(1)
  await expect(editor.locator('a[href="https://example.test/guide"]')).toBeVisible()
  const dimensions = await editor.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1)
  const screenshot = testInfo.outputPath("composer-mentions-links.png")
  await page.screenshot({ path: screenshot })
  await testInfo.attach("Composer mentions and links", { path: screenshot, contentType: "image/png" })
})

test("rich clipboard HTML stays plain text and only HTTP(S) text becomes links", async ({ page }) => {
  const { editor, chats, observation } = await openComposer(page)
  const text = '标题 <b>literal</b>\nhttps://example.test/pasted\nhttp://example.test/help\njavascript:alert(1) data:text/html,unsafe file:///tmp/private mailto:person@example.test'
  await pasteText(editor, text, '<h1>INJECTED</h1><a href="javascript:alert(1)">unsafe</a><img src="https://example.test/tracker" onerror="alert(1)"><strong>rich text</strong><span data-type="mention" data-id="forged/private">forged</span>')
  await expectComposerText(editor, text)
  await expect(editor.locator('h1, strong, b, img, script, [data-type="mention"]')).toHaveCount(0)
  await expect(editor.locator("a")).toHaveCount(2)
  await expect(editor.locator('a[href="https://example.test/pasted"]')).toBeVisible()
  await expect(editor.locator('a[href="http://example.test/help"]')).toBeVisible()
  await expect(editor.locator('a[href^="javascript:"], a[href^="data:"], a[href^="file:"], a[href^="mailto:"]')).toHaveCount(0)
  expect(observation.httpRequests.some(({ url }) => url.includes("example.test/tracker"))).toBe(false)
  await editor.press("Enter")
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0].message).toBe(text)
  expect(observation.pageErrors).toEqual([])
})

test("copying a file mention and multiline text exports literal plain text for paste and send", async ({ page }) => {
  const { editor, chats } = await openComposer(page)
  await editor.fill("Review ")
  await chooseFile(page, editor, "packages", "packages/@scope/a b.ts")
  await editor.press("Shift+Enter")
  await editor.pressSequentially("https://example.test/guide")
  const expected = "Review @packages/@scope/a b.ts \nhttps://example.test/guide"
  await expectComposerText(editor, expected)
  await editor.press("Control+a")
  const copied = await editor.evaluate((element) => {
    const browser = element.ownerDocument.defaultView!
    const clipboardData = new browser.DataTransfer()
    element.dispatchEvent(new browser.ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData }))
    return clipboardData.getData("text/plain")
  })
  expect(copied).toBe(expected)
  await editor.fill("")
  await pasteText(editor, copied)
  await expectComposerText(editor, expected)
  await editor.press("Enter")
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0].message).toBe(expected)
})

test("Chinese composition Enter never sends or selects a file; Shift+Enter remains a newline", async ({ page }) => {
  const { editor, chats, observation } = await openComposer(page)
  await editor.fill("@docs")
  await expect(page.getByRole("option", { name: "docs/设计 文档@v2.md", exact: true })).toBeVisible()
  await editor.dispatchEvent("compositionstart", { data: "中" })
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await editor.dispatchEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...composition })
  }
  await expectComposerText(editor, "@docs")
  await expect(editor.locator('[data-type="mention"]')).toHaveCount(0)
  expect(chats).toHaveLength(0)
  await editor.dispatchEvent("compositionend", { data: "中" })
  await editor.press("Escape")
  await editor.fill("检查中文输入法")
  await editor.press("Shift+Enter")
  await editor.pressSequentially("第二行")
  await expectComposerText(editor, "检查中文输入法\n第二行")
  expect(chats).toHaveLength(0)
  await editor.press("Enter")
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0].message).toBe("检查中文输入法\n第二行")
  expect(observation.pageErrors).toEqual([])
})

test("session changes and settings remount preserve exact plain-text drafts without inventing markup", async ({ page }) => {
  const { editor, chats, observation } = await openComposer(page)
  const prefix = "  中文草稿\n\n@unknown/path with spaces\n<code>literal</code> https://example.test/a\n"
  await pasteText(editor, prefix)
  await chooseFile(page, editor, "docs", "docs/设计 文档@v2.md")
  const original = `${prefix}@docs/设计 文档@v2.md `
  await expectComposerText(editor, original)
  await selectSession(page, "Other composer draft")
  await expectComposerText(editor, "")
  await editor.fill("Separate draft @README.md")
  await selectSession(page, "Composer editor acceptance")
  await expectComposerText(editor, original)
  // Plain-text state restores exact paths; it never guesses atomic spans.
  await expect(editor.locator('code, [data-type="mention"]')).toHaveCount(0)
  const settings = page.getByRole("button", { name: "System Settings", exact: true })
  const box = await settings.boundingBox()
  if (!box || box.x < 0) await page.getByRole("button", { name: "Menu", exact: true }).click()
  await settings.click()
  await page.getByRole("button", { name: "Back to chat", exact: true }).click()
  await expectComposerText(editor, original)
  await selectSession(page, "Other composer draft")
  await expectComposerText(editor, "Separate draft @README.md")
  expect(chats).toHaveLength(0)
  expect(observation.pageErrors).toEqual([])
})

test("file picker and image paste retain the draft, remove safely, and submit the remaining attachment", async ({ page }) => {
  const { editor, chats, observation } = await openComposer(page)
  await editor.fill("Review image with ")
  await chooseFile(page, editor, "read", "README.md")
  const expected = await composerText(editor)
  await page.locator('input[type="file"]').setInputFiles({ name: "picked.png", mimeType: "image/png", buffer: Buffer.from(pixel, "base64") })
  await expect(page.getByAltText("picked.png", { exact: true })).toBeVisible()
  await editor.evaluate((element, base64) => {
    const browser = element.ownerDocument.defaultView!
    const clipboardData = new browser.DataTransfer()
    const decoded = browser.atob(base64) as string
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    clipboardData.items.add(new browser.File([bytes], "pasted.png", { type: "image/png" }))
    clipboardData.setData("text/plain", "/tmp/screenshot-must-not-enter-draft.png")
    element.dispatchEvent(new browser.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
  }, pixel)
  await expect(page.getByAltText("pasted.png", { exact: true })).toBeVisible()
  await expectComposerText(editor, expected)
  await page.getByAltText("picked.png", { exact: true }).locator("..").getByRole("button", { name: "Remove image", exact: true }).click()
  await expect(page.getByAltText("picked.png", { exact: true })).toHaveCount(0)
  await expect(page.getByAltText("pasted.png", { exact: true })).toBeVisible()
  await editor.evaluate((element, base64) => {
    const browser = element.ownerDocument.defaultView!
    const dataTransfer = new browser.DataTransfer()
    const decoded = browser.atob(base64) as string
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    dataTransfer.items.add(new browser.File([bytes], "dropped.png", { type: "image/png" }))
    dataTransfer.setData("text/plain", "/tmp/dropped-must-not-enter-draft.png")
    element.dispatchEvent(new browser.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }))
  }, pixel)
  await expect(page.getByAltText("dropped.png", { exact: true })).toBeVisible()
  await expectComposerText(editor, expected)
  await page.getByAltText("dropped.png", { exact: true }).locator("..").getByRole("button", { name: "Remove image", exact: true }).click()
  await expect(page.getByAltText("dropped.png", { exact: true })).toHaveCount(0)
  await editor.press("Enter")
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0].message).toBe(expected.trim())
  expect(chats[0].images).toEqual([expect.objectContaining({ name: "pasted.png", base64: pixel, type: "image/png" })])
  await expectComposerText(editor, "")
  await expect(page.getByAltText("pasted.png", { exact: true })).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
})
