import { expect, test, type Locator, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"
import { expectComposerText } from "../support/composer.js"

const at = "2026-09-03T00:00:00.000Z"
const reviewPrefill = "Review the relevant code changes in this workspace or repository. Start with the overall scope, then list risks, notable diffs, and the most important fixes."
const reviewPrompt = "For this session, operate in code review mode."
const summary = (id: string, title: string) => ({
  id, title, kind: "root" as "root" | "child", parent_session_id: null as string | null, root_session_id: id,
  title_version: 1, session_version: 2, created_at: at, updated_at: at, last_activity_at: at,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  is_running: false, pinned: false, last_run_status: "completed", permission_mode: "default",
  root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 1,
  root_mode_birth_token: "a".repeat(64),
  execution_compatibility: { status: "compatible", session_version: 2, current_session_version: 2, execution_allowed: true, history_readable: true, conflicts: [] },
})
const dashboard = (page: Page) => page.getByTestId("home-dashboard")
const editor = (page: Page) => page.getByRole("textbox", { name: "消息", exact: true })
const query = (home: Locator) => home.getByRole("textbox", { name: "搜索模板…", exact: true })
const codeReview = (home: Locator) => home.getByRole("button", { name: /^代码评审/ })

async function fixture(page: Page, baseURL: string | undefined, sessions: ReturnType<typeof summary>[] = []) {
  const entry = new URL("/", baseURL)
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
  })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: entry.origin, entryUrl: entry.href,
  }, [], { serveStaticFromLocalServer: true })
  await page.route((url) => url.pathname === "/api/v1/sessions", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind")
    const listed = sessions.filter((entry) => !kind || entry.kind === kind)
    return route.fulfill({ json: { sessions: listed, total: listed.length, limit: 200, offset: 0 } })
  })
  await page.route(/[/]api[/]v1[/]sessions[/]home-[^/]+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)
    return route.fulfill({ json: { session: sessions.find((item) => item.id === id) }, headers: { ETag: '"1"' } })
  })
  await page.route("**/api/v1/history/home-*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)
    return route.fulfill({ json: { session_id: id, messages: [] } })
  })
  return { entry: entry.href, observation }
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`home cards, search recovery and template keyboard activation work in ${colorScheme} mode`, async ({ page, baseURL, isMobile }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" })
    const { entry, observation } = await fixture(page, baseURL)
    const sends: unknown[] = []
    await page.route("**/api/v1/chat", (route) => {
      sends.push(route.request().postDataJSON())
      return route.fulfill({ status: 400, json: { message: "Unexpected fixture submission" } })
    })
    await page.goto(entry)
    const home = dashboard(page)
    const input = editor(page)
    const search = query(home)
    const card = codeReview(home)
    await expect(home).toBeVisible()
    expect(await page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(colorScheme === "dark")
    const layout = () => card.evaluate((element) => {
      const button = element as HTMLElement
      return { width: button.offsetWidth, height: button.offsetHeight, top: button.offsetTop }
    })
    const before = await layout()
    if (!isMobile) await card.hover()
    await card.focus()
    await expect(card).toBeFocused()
    expect(await layout()).toEqual(before)

    await input.fill("保留现有草稿")
    await search.fill("no-matching-template-xyz")
    const empty = home.getByRole("status")
    await expect(empty).toHaveText(/没有匹配的模板/)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(empty).toHaveCSS("animation-name", "none")
    await empty.getByRole("button", { name: "直接描述任务", exact: true }).press("Enter")
    await expect(input).toBeFocused()
    await expectComposerText(input, "保留现有草稿")
    await expect(search).toHaveValue("no-matching-template-xyz")

    await search.focus()
    await search.dispatchEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })
    await expect(search).toHaveValue("no-matching-template-xyz")
    await search.press("Escape")
    await expect(search).toHaveValue("")
    await expect(search).toBeFocused()
    await search.fill("no-matching-template-xyz")
    await empty.getByRole("button", { name: "清空搜索", exact: true }).click()
    await expect(search).toBeFocused()
    await expect(search).toHaveValue("")
    await expect(empty).toHaveCount(0)

    await card.press("Enter")
    await expectComposerText(input, reviewPrefill)
    await expect(home).toBeVisible()
    expect(sends).toEqual([])
    expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    expect(observation.pageErrors).toEqual([])
  })
}

test("home shortcuts reset search on return and the picked template reaches only a new-session send", async ({ page, baseURL, isMobile }) => {
  const running = { ...summary("home-running", "运行中的测试会话"), is_running: true }
  const pinned = { ...summary("home-pinned", "置顶的测试会话"), pinned: true }
  const recent = summary("home-recent", "最近的测试会话")
  const child = { ...summary("home-child", "子代理测试会话"), kind: "child" as const, parent_session_id: recent.id, root_session_id: recent.id }
  const sessions = [recent, running, pinned, child]
  const { entry, observation } = await fixture(page, baseURL, sessions)
  const submissions: Array<{ session_id?: string; message: string; system_prompt?: string }> = []
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/api/v1/chat", async (route) => {
    submissions.push(route.request().postDataJSON())
    if (submissions.length === 1) await pending
    return route.fulfill({ status: 400, json: { message: "Synthetic refusal" } })
  })
  await page.goto(entry)
  async function newChat() {
    if (isMobile) await page.getByRole("banner").getByRole("button", { name: "菜单", exact: true }).click()
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click()
  }
  if (isMobile) await page.getByRole("banner").getByRole("button", { name: "菜单", exact: true }).click()
  await expect(page.getByRole("button", { name: new RegExp(`^${recent.title}`) }).first()).toBeVisible()
  await page.getByRole("button", { name: "新建会话", exact: true }).first().click()
  const home = dashboard(page)
  await expect(home.getByRole("button", { name: /^运行中的测试会话/ })).toBeVisible()
  await expect(home.getByRole("button", { name: /^置顶的测试会话/ })).toBeVisible()
  await expect(home.getByRole("button", { name: /^子代理测试会话/ })).toHaveCount(0)
  const input = editor(page)
  const homeDraft = "  keep this draft\nexactly  "
  await input.fill(homeDraft)
  await query(home).fill("no-match")
  const describeTask = home.getByRole("button", { name: "直接描述任务", exact: true })
  await describeTask.click()
  await describeTask.press("Enter")
  await expect(input).toBeFocused()
  await expectComposerText(input, homeDraft)
  await home.getByRole("button", { name: /^最近的测试会话/ }).click()
  await expect(page.getByRole("heading", { name: recent.title, exact: true })).toBeVisible()
  await expect(home).toHaveCount(0)
  await input.fill("another session's draft")
  await newChat()
  await expect(query(home)).toHaveValue("")
  await expectComposerText(input, homeDraft)
  await query(home).fill("no-match")
  await describeTask.click()
  await expect(input).toBeFocused()
  await expectComposerText(input, homeDraft)
  await query(home).fill("")

  await codeReview(home).click()
  await expectComposerText(input, reviewPrefill)
  expect(submissions).toEqual([])
  try {
    await input.press("Enter")
    await expect.poll(() => submissions.length).toBe(1)
    await expect(home).toHaveCount(0)
    expect(submissions[0]).toMatchObject({ message: reviewPrefill })
    expect(submissions[0].session_id).toBeUndefined()
    expect(submissions[0].system_prompt).toContain(reviewPrompt)
  } finally { release() }
  await expect(home).toBeVisible()
  await expectComposerText(input, reviewPrefill)
  // The refused send should leave the template prompt available for the retry.
  await input.press("Enter")
  await expect.poll(() => submissions.length).toBe(2)
  expect(submissions[1].system_prompt).toBe(submissions[0].system_prompt)
  expect(observation.pageErrors).toEqual([])
})
