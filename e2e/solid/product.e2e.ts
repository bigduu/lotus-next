import { expect, test } from "@playwright/test";
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js";

for (const mode of ["idle", "running", "monitoring"] as const) {
  const queued = mode !== "idle";
  const action = mode === "monitoring" ? "queues guidance while a command is monitored"
    : queued ? "queues guidance during a run" : "sends a draft through Bamboo";
  test(`Solid Lotus restores a session and ${action}`, async ({ page, baseURL }, info) => {
    const id = "all-surface-session";
    const entryUrl = new URL("/", baseURL).href;
    const session = {
      id,
      title: "Solid active conversation",
      kind: "root",
      root_session_id: id,
      created_at: "2026-09-07T00:00:00Z",
      updated_at: "2026-09-07T00:00:00Z",
      model: "fixture-model",
      model_ref: { provider: "fixture-provider", model: "fixture-model" },
      permission_mode: "default",
      root_orchestration_only: false,
      root_mode_transition_epoch: 0,
      root_mode_birth_token: "a".repeat(64),
      thinking_mode: "standard",
      is_running: mode === "running",
      last_run_status: mode === "monitoring" ? "suspended" : mode === "running" ? "running" : "completed",
      ...(mode === "monitoring" ? { activity: "waiting_bash" } : {}),
    };
    await page.addInitScript((selected) => {
      localStorage.setItem("lotus_next_last_session", selected);
      localStorage.setItem("bodhi_onboarded_v1", "1");
    }, id);
    const history = [{ id: "saved-answer", role: "assistant", content: "Existing **Solid history**", created_at: session.created_at }];
    if (mode === "monitoring") history.push({
      id: "monitoring-notice", role: "assistant", content: "Moved command `build-001` to background monitoring.",
      created_at: "2026-09-07T00:00:01Z",
    });
    const observation = await installArtifactRuntime(page, {
      ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
    }, history, {
      serveStaticFromLocalServer: true,
    });
    await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: {
      sessions: [session], total: 1, limit: 200, offset: 0,
    } }));
    await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({
      json: { session }, headers: { ETag: '"1"' },
    }));
    await page.route(`**/api/v1/task/${id}`, (route) => route.fulfill({ json: {
      session_id: id, title: "Fixture plan", version: 1,
      items: [{ id: "prepare", description: "Prepare the workspace", status: "pending", depends_on: [], notes: "" }],
      progress: { completed: 0, total: 1, percentage: 0 },
    } }));
    const submissions: unknown[] = [];
    await page.route(queued ? `**/api/v1/sessions/${id}/guidance` : "**/api/v1/chat", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON();
      submissions.push(body);
      return route.fulfill(queued
        ? { status: 202, json: { id: body.id, activation_pending: false } }
        : { json: { session_id: id, status: "success" } });
    });
    await page.route(`**/api/v1/execute/${id}`, (route) => route.fulfill({
      json: { session_id: id, status: "started", run_id: "solid-run-1" },
    }));
    await page.goto(entryUrl);
    await expect(page.getByRole("heading", { name: session.title })).toBeVisible();
    await expect(page.locator("[data-virtual-history]")).toContainText("Existing Solid history");
    await page.getByRole("button", { name: "打开会话任务图" }).click();
    const tasks = page.locator("#right-workbench");
    await expect(tasks.getByRole("button", { name: /Prepare the workspace/ })).toBeVisible();
    await tasks.getByRole("button", { name: "收起工作面板" }).click();
    await expect(tasks).toBeHidden();

    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.focus();
    await page.keyboard.press("Control+k");
    const palette = page.locator("[data-command-palette]");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(composer).toBeFocused();

    await page.locator('button[aria-controls="right-workbench"]').click();
    const workbench = page.locator("#right-workbench");
    await expect(workbench).toBeVisible();
    await workbench.getByRole("button", { name: "打开工作面板标签页" }).click();
    await workbench.getByRole("menuitem", { name: /Review/ }).click();
    await expect(workbench.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");
    const closeReview = workbench.getByRole("button", { name: "关闭Review标签页" });
    await closeReview.press("Enter");
    await expect(workbench.getByRole("tab", { name: "会话任务 DAG", exact: true })).toBeFocused();
    if (mode === "idle" && info.project.name === "phone-chromium") {
      await info.attach("Phone workbench focus after closing Review", { body: await page.screenshot(), contentType: "image/png" });
    }
    await workbench.getByRole("button", { name: /^关闭.+标签页$/ }).press("Enter");
    await expect(workbench.getByRole("tab")).toHaveCount(0);
    await expect(workbench.getByRole("button", { name: "打开工作面板标签页" })).toBeFocused();
    await workbench.getByRole("button", { name: "收起工作面板" }).click();
    await expect(workbench).toBeHidden();
    await composer.fill("从 Solid 发送");
    if (queued) {
      await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();
      await page.getByRole("combobox", { name: "发送时机" }).selectOption("after_run");
    } else {
      await page.locator('input[type="file"]').setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEboAAAAASUVORK5CYII=", "base64"),
      });
      await expect(page.getByRole("img", { name: "fixture.png" })).toBeVisible();
    }
    if (!queued) await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled();
    await composer.press("Enter");
    await expect.poll(() => submissions).toEqual([expect.objectContaining(queued
      ? { text: "从 Solid 发送", mode: "after_run" }
      : { message: "从 Solid 发送", session_id: id, images: [expect.objectContaining({ name: "fixture.png" })] })]);
    await expect(composer).not.toContainText("从 Solid 发送");
    expect(observation.bootstrapDocuments).toHaveLength(1);
    expect(observation.webSocketUrls).toContain(new URL("/v2/stream", baseURL).href.replace("http:", "ws:"));
    expect(observation.pageErrors).toEqual([]);
    expect(observation.protocolErrors).toEqual([]);
  });
}

test("a dense remote header keeps its title and Workbench reachable without scrolling the chat sideways", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Explicit phone and desktop width transition");
  const id = "all-surface-session";
  const entryUrl = new URL("/", baseURL).href;
  const session = {
    id, title: "Remote release checklist", kind: "root", root_session_id: id,
    created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    permission_mode: "default", thinking_mode: "standard", root_orchestration_only: false,
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64), last_run_status: "completed", is_running: false,
    placement: { kind: "ssh", host: "fixture-runner.example" },
  };
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript((selected) => {
    localStorage.setItem("lotus_next_last_session", selected);
    localStorage.setItem("bodhi_onboarded_v1", "1");
    localStorage.setItem("lotus_ui_locale_v1", "en-US");
  }, id);
  const history = [{ id: "layout-note", role: "assistant", content: "The release checklist is ready for review.", created_at: session.created_at }];
  await installArtifactRuntime(page, { ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl }, history, {
    serveStaticFromLocalServer: true,
  });
  await page.route("**/api/v1/sessions?*", (route) => {
    const sessions = new URL(route.request().url()).searchParams.get("kind") === "child" ? [] : [session];
    return route.fulfill({ json: { sessions, total: sessions.length, features: ["session_side_chat"] } });
  });
  await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }));
  await page.route(`**/api/v1/task/${id}`, (route) => route.fulfill({ json: {
    session_id: id, title: "Fixture plan", version: 1,
    items: [{ id: "prepare", description: "Prepare the workspace", status: "pending", depends_on: [], notes: "" }],
  } }));
  await page.goto(entryUrl);
  const header = page.getByRole("banner");
  const title = header.getByRole("heading", { name: session.title, exact: true });
  const placement = header.getByTitle("Running on ssh · fixture-runner.example", { exact: true });
  const more = header.getByRole("button", { name: "More", exact: true });
  const launcher = header.getByRole("button", { name: "Open side panel", exact: true });
  await expect(header.getByRole("button", { name: "Open Side Chat", exact: true })).toBeVisible();
  await expect(placement).toBeVisible();
  await expect.poll(() => title.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(40);
  await expect(launcher).toBeInViewport({ ratio: 1 });
  await more.focus();
  await page.keyboard.press("Tab");
  await expect(launcher).toBeFocused();
  await expect.poll(() => page.locator("#chat-panel").evaluate((element) => element.scrollLeft)).toBe(0);
  const screenshot = info.outputPath("dense-remote-header-320.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("dense-remote-header-320", { path: screenshot, contentType: "image/png" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Select working directory", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Open subagent tree", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Open session task DAG", exact: true }).click();
  const workbench = page.locator("#right-workbench");
  await expect(workbench.getByRole("button", { name: /Prepare the workspace/ })).toBeVisible();
  await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click();
  const dag = header.getByRole("button", { name: "Open session task DAG", exact: true });
  await page.setViewportSize({ width: 512, height: 740 });
  await expect(dag).toBeVisible();
  await expect.poll(() => title.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(40);
  await expect(launcher).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1100, height: 900 });
  await dag.press("Enter");
  await expect(workbench.getByRole("button", { name: /Prepare the workspace/ })).toBeVisible();
  await expect(dag).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Collapse side panel", exact: true })).toBeFocused();
  await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click();
  await page.getByRole("button", { name: "New Session", exact: true }).click();
  await expect(page.getByTestId("home-dashboard")).toBeVisible();
  await expect(launcher).toHaveCount(0);
});
