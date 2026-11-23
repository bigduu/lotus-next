import { expect, test } from "@playwright/test";
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js";

for (const running of [false, true]) {
  test(`Solid Lotus restores a session and ${running ? "queues guidance during a run" : "sends a draft through Bamboo"}`, async ({ page, baseURL }) => {
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
      is_running: running,
      last_run_status: running ? "running" : "completed",
    };
    await page.addInitScript((selected) => {
      localStorage.setItem("lotus_next_last_session", selected);
      localStorage.setItem("bodhi_onboarded_v1", "1");
    }, id);
    const observation = await installArtifactRuntime(page, {
      ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
    }, [{ id: "saved-answer", role: "assistant", content: "Existing **Solid history**", created_at: session.created_at }], {
      serveStaticFromLocalServer: true,
    });
    await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: {
      sessions: [session], total: 1, limit: 200, offset: 0,
    } }));
    await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({
      json: { session }, headers: { ETag: '"1"' },
    }));
    const submissions: unknown[] = [];
    await page.route(running ? `**/api/v1/sessions/${id}/guidance` : "**/api/v1/chat", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON();
      submissions.push(body);
      return route.fulfill(running
        ? { status: 202, json: { id: body.id, activation_pending: false } }
        : { json: { session_id: id, status: "success" } });
    });
    await page.route(`**/api/v1/execute/${id}`, (route) => route.fulfill({
      json: { session_id: id, status: "started", run_id: "solid-run-1" },
    }));
    await page.goto(entryUrl);
    await expect(page.getByRole("heading", { name: session.title })).toBeVisible();
    await expect(page.locator("[data-virtual-history]")).toContainText("Existing Solid history");
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
    await workbench.getByRole("button", { name: /Review/ }).first().click();
    await expect(workbench.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");
    await workbench.getByRole("button", { name: "收起工作面板" }).click();
    await expect(workbench).toBeHidden();
    await composer.fill("从 Solid 发送");
    if (running) {
      await page.getByRole("combobox", { name: "发送时机" }).selectOption("after_run");
    } else {
      await page.locator('input[type="file"]').setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEboAAAAASUVORK5CYII=", "base64"),
      });
      await expect(page.getByRole("img", { name: "fixture.png" })).toBeVisible();
    }
    await composer.press("Enter");
    await expect.poll(() => submissions).toEqual([expect.objectContaining(running
      ? { text: "从 Solid 发送", mode: "after_run" }
      : { message: "从 Solid 发送", session_id: id, images: [expect.objectContaining({ name: "fixture.png" })] })]);
    await expect(composer).not.toContainText("从 Solid 发送");
    expect(observation.bootstrapDocuments).toHaveLength(1);
    expect(observation.webSocketUrls).toContain(new URL("/v2/stream", baseURL).href.replace("http:", "ws:"));
    expect(observation.pageErrors).toEqual([]);
    expect(observation.protocolErrors).toEqual([]);
  });
}
