import { expect, test } from "@playwright/test";
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js";

test("opens a Solid Lotus session, loads its history and submits a draft through Bamboo", async ({ page, baseURL }) => {
  const id = "all-surface-session";
  const entryUrl = new URL("/solid-candidate.html", baseURL).href;
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
    is_running: false,
    last_run_status: "completed",
  };
  await page.addInitScript((selected) => localStorage.setItem("lotus_next_last_session", selected), id);
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
  await page.route("**/api/v1/chat", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { session_id: id, status: "success" } });
  });
  await page.route(`**/api/v1/execute/${id}`, (route) => route.fulfill({
    json: { session_id: id, status: "started", run_id: "solid-run-1" },
  }));
  await page.goto(entryUrl);
  await expect(page.getByRole("heading", { name: session.title })).toBeVisible();
  await expect(page.locator("[data-virtual-history]")).toContainText("Existing Solid history");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.fill("从 Solid 发送");
  await composer.press("Enter");
  await expect.poll(() => submissions).toEqual([expect.objectContaining({ message: "从 Solid 发送", session_id: id })]);
  await expect(composer).not.toContainText("从 Solid 发送");
  expect(observation.bootstrapDocuments).toHaveLength(1);
  expect(observation.webSocketUrls).toContain(new URL("/v2/stream", baseURL).href.replace("http:", "ws:"));
  expect(observation.pageErrors).toEqual([]);
});
