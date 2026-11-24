import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

const id = "all-surface-session"
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const skills = ["first-skill", "next-skill"].map((name) => ({
  id: name, name, description: "Fixture Skill", prompt: "Use the selected Skill", tool_refs: [],
}))
const input = (page: Page) => page.getByRole("textbox", { name: "消息", exact: true })
const send = (page: Page) => page.getByRole("button", { name: "发送消息", exact: true })
const surface = (page: Page) => page.locator("[data-composer-surface]")
const draftImage = (page: Page, name: string) => surface(page).getByAltText(name, { exact: true })
const pickImage = (page: Page, name: string) => page.locator('input[type="file"]').setInputFiles({
  name, mimeType: "image/png", buffer: Buffer.from(pixel, "base64"),
})
type ChatPost = {
  message: string
  session_id?: string
  system_prompt?: string
  selected_skill_ids?: string[]
  images?: Array<{ name: string; base64: string; type: string }>
}

async function fixture(page: Page, blank: boolean, refuseFirst = false) {
  await page.addInitScript((sessionId) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("lotus_next_last_session", sessionId)
  }, id)
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  await page.route("**/api/v1/skills", (route) => route.fulfill({ json: { skills, total: skills.length } }))
  const posts: ChatPost[] = []
  let executes = 0
  let release!: () => void
  const firstReceipt = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/api/v1/chat", async (route) => {
    posts.push(route.request().postDataJSON())
    if (posts.length === 1) {
      await firstReceipt
      if (refuseFirst) return route.fulfill({ status: 400, json: { error: "Fixture acknowledgement unavailable" } })
    }
    return route.fulfill({ json: { session_id: id, message_id: `ack-${posts.length}`, status: "success" } })
  })
  await page.route(`**/api/v1/execute/${id}`, (route) => {
    executes += 1
    return route.fulfill({ json: { session_id: id, status: "started", events_url: "/v2/stream" } })
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
  if (blank) {
    await openNewChat(page)
    await expect(page.getByTestId("home-dashboard")).toBeVisible()
  }
  await expect(input(page)).toHaveAttribute("contenteditable", "true")
  return { runtime, posts, release, get executes() { return executes } }
}

async function pickSkill(page: Page, id: string) {
  await input(page).fill(`/${id}`)
  await page.getByRole("option", { name: new RegExp(`^/${id}`) }).click()
  await expect(surface(page).getByRole("button", { name: "移除技能", exact: true })).toBeVisible()
}

async function openNewChat(page: Page) {
  const newSession = page.getByRole("button", { name: "新建会话", exact: true })
  const bounds = await newSession.boundingBox()
  if (!bounds || bounds.x < 0) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await newSession.click()
  await expect(page.getByRole("banner").getByRole("heading", { name: "新会话", exact: true })).toBeVisible()
}

test("retains a refused new-chat draft, image and template and returns focus for an explicit retry", async ({ page }) => {
  const state = await fixture(page, true, true)
  const raw = "  preserve this exact new draft  "
  const editor = input(page)
  await page.getByTestId("home-dashboard").getByRole("button", { name: /^代码评审/ }).click()
  await editor.fill(raw)
  await pickImage(page, "pending.png")
  await expect(draftImage(page, "pending.png")).toBeVisible()
  try {
    await send(page).click()
    await expect.poll(() => state.posts.length).toBe(1)
    expect(state.executes).toBe(0)
    await expectComposerText(editor, raw)
    await expect(draftImage(page, "pending.png")).toBeVisible()
    expect(state.posts[0]).toMatchObject({
      message: raw.trim(),
      images: [expect.objectContaining({ name: "pending.png", type: "image/png", base64: pixel })],
    })
    expect(state.posts[0].session_id).toBeUndefined()
    expect(state.posts[0].system_prompt).toContain("For this session, operate in code review mode.")
  } finally {
    state.release()
  }
  await expect(page.getByRole("alert").filter({ hasText: "Fixture acknowledgement unavailable" })).toBeVisible()
  await expect(editor).toBeFocused()
  await expectComposerText(editor, raw)
  await expect(draftImage(page, "pending.png")).toBeVisible()
  expect(state.executes).toBe(0)
  await page.keyboard.press("Enter")
  await expect.poll(() => state.executes).toBe(1)
  expect(state.posts[1]).toMatchObject(state.posts[0])
  await expectComposerText(editor, "")
  await expect(draftImage(page, "pending.png")).toHaveCount(0)
  expect(state.runtime.pageErrors).toEqual([])
})

for (const edits of [false, true]) {
  test(`reconciles an acknowledged message with ${edits ? "newer" : "unchanged"} Skill, draft, and images`, async ({ page }) => {
    const state = await fixture(page, false)
    const editor = input(page)
    await pickSkill(page, "first-skill")
    await editor.fill("Original request")
    await pickImage(page, "before.png")
    await expect(draftImage(page, "before.png")).toBeVisible()
    try {
      await send(page).click()
      await expect.poll(() => state.posts.length).toBe(1)
      expect(state.posts[0]).toMatchObject({
        session_id: id, message: "Original request", selected_skill_ids: ["first-skill"],
        images: [expect.objectContaining({ name: "before.png", type: "image/png", base64: pixel })],
      })
      expect(state.executes).toBe(0)
      await expectComposerText(editor, "Original request")
      await expect(draftImage(page, "before.png")).toBeVisible()
      if (edits) {
        await pickSkill(page, "next-skill")
        await pickImage(page, "after.png")
        await expect(draftImage(page, "after.png")).toBeVisible()
        await editor.fill("A replacement draft")
      }
    } finally {
      state.release()
    }
    await expect.poll(() => state.executes).toBe(1)
    if (edits) {
      await expectComposerText(editor, "A replacement draft")
      await expect(surface(page).getByText("/next-skill", { exact: true })).toBeVisible()
      await expect(draftImage(page, "before.png")).toBeVisible()
      await expect(draftImage(page, "after.png")).toBeVisible()
    } else {
      await expectComposerText(editor, "")
      await expect(surface(page).getByRole("button", { name: "移除技能", exact: true })).toHaveCount(0)
      await expect(draftImage(page, "before.png")).toHaveCount(0)
    }
    expect(state.posts).toHaveLength(1)
    expect(state.runtime.errorResponses).toEqual([])
    expect(state.runtime.pageErrors).toEqual([])
  })
}

test("moves only the newer draft into the new session after its first message is acknowledged", async ({ page }) => {
  const state = await fixture(page, true)
  const editor = input(page)
  await editor.fill("First request with a held receipt")
  try {
    await send(page).click()
    await expect.poll(() => state.posts.length).toBe(1)
    expect(state.posts[0].session_id).toBeUndefined()
    expect(state.posts[0].message).toBe("First request with a held receipt")
    await editor.fill("Next draft after acknowledgement")
    expect(state.executes).toBe(0)
  } finally {
    state.release()
  }
  await expect.poll(() => state.executes).toBe(1)
  await expect(page.getByTestId("home-dashboard")).toHaveCount(0)
  await expect(page.locator("[data-pending-user-message]")).toHaveText("First request with a held receipt")
  await expectComposerText(editor, "Next draft after acknowledgement")

  await openNewChat(page)
  await expect(page.getByTestId("home-dashboard")).toBeVisible()
  await expectComposerText(editor, "")
  expect(state.posts).toHaveLength(1)
  expect(state.runtime.errorResponses).toEqual([])
  expect(state.runtime.pageErrors).toEqual([])
})

test("a delayed refusal does not take focus from the replacement chat", async ({ page }) => {
  const state = await fixture(page, false, true)
  await input(page).fill("A request from the chat I am leaving")
  const search = page.getByRole("textbox", { name: "搜索会话", exact: true })
  try {
    await send(page).click()
    await expect.poll(() => state.posts.length).toBe(1)
    await openNewChat(page)
    await input(page).fill("Keep the replacement chat's draft")
    await expect(input(page)).toHaveAttribute("aria-busy", "true")
    const bounds = await search.boundingBox()
    if (!bounds || bounds.x < 0) await page.getByRole("button", { name: "菜单", exact: true }).click()
    await search.focus()
    await expect(search).toBeFocused()
  } finally {
    state.release()
  }
  await expect(input(page)).toHaveAttribute("aria-busy", "false")
  await expect(search).toBeFocused()
  await page.keyboard.press("Escape")
  await expectComposerText(input(page), "Keep the replacement chat's draft")
  expect(state.posts).toHaveLength(1)
  expect(state.executes).toBe(0)
  expect(state.runtime.pageErrors).toEqual([])
})
