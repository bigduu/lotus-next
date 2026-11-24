import { expect, test, type Locator, type Page } from "@playwright/test"
import type { PatchProjectRequest, ProjectManifest } from "../../src/services/project"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const alphaId = "drag-alpha"
const betaId = "drag-beta"
const root = "all-surface-session"
const movable = "drag-movable"
const leader = "drag-leader"
const follower = "drag-follower"
const sourceSection = "source"
const destination = "destination"
const at = "2026-11-22T00:00:00Z"

function manifest(id: string, name: string, sidebar: NonNullable<ProjectManifest["sidebar"]>): ProjectManifest {
  return {
    id, name, status: "active", revision: 1, resource_revision: 1, schema_version: 3,
    project_path: `/fixture/${id}`, project_path_status: "configured", workspace_count: 1, workspace_bindings: [],
    created_at: at, updated_at: at, sidebar,
  }
}

async function fixture(page: Page, baseURL: string | undefined) {
  const entryUrl = new URL("/", baseURL).href
  const projects = {
    [alphaId]: manifest(alphaId, "Drag Project Alpha", {
      sections: [{ id: sourceSection, name: "Source section" }, { id: destination, name: "Destination section" }],
      session_sections: { [root]: sourceSection, [movable]: sourceSection, [leader]: destination, [follower]: destination },
      hidden_legacy: false,
    }),
    [betaId]: manifest(betaId, "Drag Project Beta", { sections: [], session_sections: {}, hidden_legacy: false }),
  }
  const sessions = [
    [root, "Alpha current", alphaId, 4], [movable, "Alpha movable", alphaId, 1],
    [leader, "Destination leader", alphaId, 3], [follower, "Destination follower", alphaId, 2],
    ["drag-sibling", "Beta independent", betaId, 5],
  ].map(([id, title, projectId, age]) => ({
    id, title, title_version: 1, kind: "root", root_session_id: id, project_id: projectId,
    pinned: false, is_running: false, model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: `2026-11-22T00:00:0${age}Z`, updated_at: at, message_count: 0, subagent_count: 0,
    permission_mode: "default", root_orchestration_only: false, thinking_mode: "standard",
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  }))
  await page.addInitScript((rootId) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("lotus_next_last_session", rootId)
  }, root)
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const writes: { projectId: string; revision: string | undefined; body: PatchProjectRequest }[] = []
  let nextWrite: Promise<void> | undefined
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === "/api/v1/projects") return route.fulfill({ json: { projects: Object.values(projects) } })
    const project = Object.values(projects).find((project) => url.pathname === `/api/v1/projects/${project.id}`)
    if (project) {
      if (request.method() === "GET") return route.fulfill({ json: project, headers: { ETag: `"${project.revision}"` } })
      expect(request.method()).toBe("PATCH")
      const body: PatchProjectRequest = request.postDataJSON()
      const revision = request.headers()["if-match"]
      writes.push({ projectId: project.id, revision, body })
      const held = nextWrite
      nextWrite = undefined
      if (held) await held
      expect(revision).toBe(`"${project.revision}"`)
      expect(Object.keys(body)).toEqual(["sidebar"])
      expect(body.sidebar).toBeDefined()
      project.sidebar = body.sidebar
      project.revision += 1
      return route.fulfill({ json: project, headers: { ETag: `"${project.revision}"` } })
    }
    if (url.pathname === "/api/v1/sessions") {
      const listed = url.searchParams.get("kind") === "root" ? sessions : []
      return route.fulfill({ json: { sessions: listed, total: listed.length, limit: 200, offset: 0 } })
    }
    const session = sessions.find((session) => url.pathname.endsWith("/" + session.id))
    if (session && url.pathname.startsWith("/api/v1/sessions/")) {
      return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    }
    if (session && url.pathname.startsWith("/api/v1/history/")) {
      return route.fulfill({ json: { session_id: session.id, messages: [] } })
    }
    if (session && url.pathname.startsWith("/api/v1/task/")) {
      return route.fulfill({ json: { session_id: session.id, items: [] } })
    }
    return route.fallback()
  })
  return { entryUrl, observed, projects, writes, holdNextWrite: (hold: Promise<void>) => { nextWrite = hold } }
}

const section = (page: Page, id: string, projectId = alphaId) =>
  page.locator(`[data-section-project="${projectId}"][data-section-id="${id}"]`)
const row = (owner: Locator, id: string) => owner.locator(`[data-sidebar-session="${id}"]`)
const handle = (page: Page, kind: "session" | "section", id: string) => page.locator(`[data-sidebar-drag-handle="${kind}:${id}"]:not([inert])`)
const header = (owner: Locator) => owner.locator("[data-sidebar-section-header]").first()

async function openSidebar(page: Page, isMobile: boolean) {
  await expect(page.getByRole("heading", { name: "Alpha current", exact: true })).toBeVisible()
  if (isMobile) await page.getByRole("button", { name: "Menu", exact: true }).click()
}

async function gestureDrop(
  page: Page, grip: Locator, target: Locator, bucket: Locator, touch: boolean, relativeY = 0.5, reject = false,
) {
  await grip.scrollIntoViewIfNeeded()
  await expect(target).toBeVisible()
  const start = (await grip.boundingBox())!
  const end = (await target.boundingBox())!
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  const to = { x: end.x + end.width / 2, y: end.y + end.height * relativeY }
  if (touch) {
    const session = await page.context().newCDPSession(page)
    const touchPoint = (x: number, y: number) => [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoint(from.x, from.y) })
      await expect(grip).toHaveAttribute("data-sidebar-dragging", "true")
      for (let step = 1; step <= 10; step += 1) await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touchPoint(from.x + (to.x - from.x) * step / 10, from.y + (to.y - from.y) * step / 10),
      })
      await expect(bucket).toHaveAttribute("data-drop-active", "true")
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    } finally {
      await session.detach()
    }
  } else {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 9, from.y + 7)
    await expect(grip).toHaveAttribute("data-sidebar-dragging", "true")
    await page.mouse.move(to.x, to.y, { steps: 12 })
    if (reject) {
      await expect(page.locator("aside").getByRole("status").filter({ hasText: "Cross-project moves are not supported" })).toBeVisible()
      await expect(bucket).not.toHaveAttribute("data-drop-active", "true")
    } else {
      await expect(bucket).toHaveAttribute("data-drop-active", "true")
    }
    await page.mouse.up()
  }
}

test("Solid sidebar drag writes project membership and persists explicit row ranks", async ({ page, baseURL, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 960 })
  const { entryUrl, observed, projects, writes } = await fixture(page, baseURL)
  await page.goto(entryUrl)
  await openSidebar(page, isMobile)
  const grip = handle(page, "session", movable)
  const bucket = section(page, destination)
  await expect(row(section(page, sourceSection), movable)).toHaveAttribute("draggable", "true")
  await gestureDrop(page, grip, header(bucket), bucket, isMobile)
  await expect(row(bucket, movable)).toBeVisible()
  expect(projects[alphaId].sidebar?.session_sections[movable]).toBe(destination)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ projectId: alphaId, revision: '"1"' })

  await gestureDrop(page, grip, row(bucket, leader), bucket, isMobile, 0.2)
  const ordered = () => bucket.locator("[data-sidebar-session]").evaluateAll((rows) => rows.map((item) => item.getAttribute("data-sidebar-session")))
  await expect.poll(ordered).toEqual([movable, leader, follower])
  expect(writes).toHaveLength(1)
  await expect(row(section(page, sourceSection), root).getByRole("button", { name: "Alpha current", exact: true })).toHaveAttribute("aria-current", "page")
  await page.reload()
  await openSidebar(page, isMobile)
  await expect.poll(ordered).toEqual([movable, leader, follower])
  expect(writes).toHaveLength(1)
  expect(observed.pageErrors).toEqual([])
})

async function keyboardPosition(page: Page, source: Locator, target: Locator, bucket: Locator, before = false) {
  await source.scrollIntoViewIfNeeded()
  await expect(target).toBeVisible()
  const start = (await source.boundingBox())!
  const end = (await target.boundingBox())!
  await source.focus()
  await page.keyboard.press("Space")
  await expect(source).toHaveAttribute("data-sidebar-dragging", "true")
  const steps = Math.round((end.y + end.height * (before ? 0.2 : 0.5) - start.y - start.height / 2) / 10)
  for (let index = 0; index < Math.abs(steps); index += 1) await page.keyboard.press(steps < 0 ? "ArrowUp" : "ArrowDown")
  await expect(bucket).toHaveAttribute("data-drop-active", "true")
}

test("Solid sidebar keyboard drag cancels on resize and restores the moved handle after confirmation", async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, "Keyboard and mouse fixture with desktop sidebar")
  await page.setViewportSize({ width: 1280, height: 960 })
  const { entryUrl, observed, projects, writes, holdNextWrite } = await fixture(page, baseURL)
  await page.goto(entryUrl)
  await openSidebar(page, false)
  const grip = handle(page, "session", movable)
  const bucket = section(page, destination)
  await keyboardPosition(page, grip, header(bucket), bucket)
  await page.setViewportSize({ width: 1300, height: 970 })
  await expect(grip).not.toHaveAttribute("data-sidebar-dragging", "true")
  expect(writes).toHaveLength(0)

  const held = Promise.withResolvers<void>()
  try {
    holdNextWrite(held.promise)
    await keyboardPosition(page, grip, header(bucket), bucket)
    await page.keyboard.press("Space")
    await expect.poll(() => writes.length).toBe(1)
    const original = row(section(page, sourceSection), movable)
    await expect(original).toBeVisible()
    await expect(grip).toBeDisabled()
    await expect(grip).not.toHaveAttribute("data-sidebar-dragging", "true")
    await expect(page.locator("aside [data-dnd-dragging], aside [data-dnd-placeholder]")).toHaveCount(0)
    held.resolve()
    await expect(row(bucket, movable)).toBeVisible()
    await expect(grip).toBeFocused()
  } finally {
    held.resolve()
  }

  const sectionGrip = handle(page, "section", destination)
  const upper = section(page, sourceSection)
  await keyboardPosition(page, sectionGrip, header(upper), upper, true)
  await page.keyboard.press("Space")
  await expect.poll(() => projects[alphaId].sidebar?.sections.map((section) => section.id)).toEqual([destination, sourceSection])
  expect(writes.map((write) => write.revision)).toEqual(['"1"', '"2"'])

  const other = section(page, "none", betaId)
  await gestureDrop(page, handle(page, "session", "drag-sibling"), header(bucket), bucket, false, 0.5, true)
  const sibling = row(other, "drag-sibling")
  await expect(sibling).toBeVisible()
  await expect(row(bucket, "drag-sibling")).toHaveCount(0)
  await bucket.evaluate((element, projectId) => {
    const transfer = new DataTransfer()
    transfer.setData("application/x-lotus-sidebar-session", JSON.stringify({ projectId, sessionId: "drag-sibling" }))
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }))
  }, alphaId)
  expect(writes).toHaveLength(2)

  const next = Promise.withResolvers<void>()
  try {
    holdNextWrite(next.promise)
    await keyboardPosition(page, grip, header(upper), upper)
    await page.keyboard.press("Space")
    await expect.poll(() => writes.length).toBe(3)
    const composer = page.locator("[data-composer-editor]")
    await composer.click()
    await composer.fill("Keep the new editor focus")
    next.resolve()
    await expect(row(upper, movable)).toBeVisible()
    await expect(composer).toBeFocused()
    await expect(composer).toHaveText("Keep the new editor focus")
    expect(writes[2]).toMatchObject({ projectId: alphaId, revision: '"3"' })
  } finally {
    next.resolve()
  }
  expect(observed.pageErrors).toEqual([])
})
