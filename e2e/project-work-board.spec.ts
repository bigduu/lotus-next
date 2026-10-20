import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const colorScheme of ["light", "dark"] as const) {
  test(`project Work board remains read-only and responsive in ${colorScheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme })
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    })
    const observation = await installArtifactRuntime(page, standaloneScenario)
    const project = { id: "project-board", name: "Project Board", status: "active", revision: 3, resource_revision: 2, schema_version: 3,
      sidebar: { sections: [], session_sections: {}, hidden_legacy: false }, project_path: "/workspace/frontend", project_path_status: "configured", workspace_count: 2,
      workspace_bindings: [{ path: "/workspace/frontend", label: "Frontend" }, { path: "/workspace/backend", label: "Backend" }], created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z" }
    const snapshot = { commit: "fixture-snapshot", seq: 10, authority_epoch: 1 }
    const envelope = { snapshot, index_seq: 10, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null }
    const rows = (["ready", "blocked", "submitted", "accepted", "cancelled"] as const).map((state, index) => ({
      ticket: { id: `work-${index}`, scope_id: "scope", kind: "work", state, generation: 1, record_revision: 1, contract_revision: 1, updated_seq: 10, archived: false,
        contract: { title: ["Draft the shared contract", "Waiting on backend", "Review submission evidence", "Verified acceptance", "Cancelled experiment"][index], objective: "Preserve explicit project membership", constraints: [], acceptance: ["Evidence verified"] },
        blocked: state === "blocked" ? { reason: "Dependency pending", resume_state: "active" } : null, paused: state === "blocked", active_assignment: "assignment", current_submission: state === "submitted" ? "submission" : null, accepted_submission: null, depends_on: [] },
      stage: ["todo", "doing", "testing", "done", null][index], context: null, adopted_context: null,
    }))
    await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [project] } }))
    await page.route("**/api/v1/projects/project-board", (route) => route.fulfill({ json: project }))
    await page.route("**/api/v1/tickets/project-board", (route) => route.fulfill({ json: { ...envelope, data: { project_id: project.id,
      counts: { todo: 1, doing: 1, testing: 1, done: 1, blocked: 1, cancelled: 1, total: 5 },
      rows: route.request().postDataJSON().include_cancelled ? rows : rows.slice(0, 4),
    } } }))
    await page.route("**/api/v1/tickets/inspect", (route) => route.fulfill({ json: { ...envelope, data: [{ ticket: rows[2].ticket, requests: [],
      assignments: [{ id: "assignment", state: "running", runtime: { session_id: "owner-session", run_id: "run-1" }, workspace: null }],
      submissions: [{ id: "submission", work_id: "work-2", generation: 1, contract_revision: 1, stale: false, artifacts: [], evidence: ["All checks passed"], updated_seq: 10 }],
    }] } }))
    await page.route("**/api/v1/tickets/sprints/list", (route) => route.fulfill({ status: 404, json: { error: "Sprint planning is unsupported by this legacy fixture" } }))
    await page.goto(standaloneScenario.entryUrl)
    if (info.project.name === "phone-chromium") await page.getByRole("button", { name: "菜单", exact: true }).click()
    await page.getByRole("button", { name: "Project Board 项目操作", exact: true }).click()
    await page.getByRole("menuitem", { name: "项目工作", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Draft the shared contract", { exact: true })).toBeVisible()
    const listButton = dialog.getByRole("button", { name: "列表", exact: true })
    const boardButton = dialog.getByRole("button", { name: "看板", exact: true })
    await expect(listButton).toHaveAttribute("aria-pressed", "true")
    await expect(listButton).toHaveClass(/bg-primary/)
    await boardButton.click()
    await dialog.getByRole("checkbox", { name: "显示已取消" }).focus()
    await expect(boardButton).toHaveAttribute("aria-pressed", "true")
    await expect(boardButton).toHaveClass(/bg-primary/)
    await expect(listButton).toHaveAttribute("aria-pressed", "false")
    await expect(dialog.getByRole("region", { name: "进行中", exact: true })).toContainText("Dependency pending")
    await dialog.getByRole("checkbox", { name: "显示已取消" }).check()
    await expect(dialog.getByText("Cancelled experiment", { exact: true })).toBeVisible()
    await expect(dialog.getByRole("region", { name: "已验收", exact: true })).not.toContainText("Cancelled experiment")
    await dialog.getByTestId("project-work-work-2").click()
    await expect(dialog.getByTestId("project-work-details")).toContainText("All checks passed")
    await expect(dialog.getByTestId("project-work-details")).toContainText("owner-session")
    await dialog.getByRole("button", { name: "关闭详情" }).click()
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await info.attach(`project-work-${colorScheme}`, { body: await page.screenshot(), contentType: "image/png" })
    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible()
    expect(observation.pageErrors).toEqual([])
    expect(observation.httpRequests.filter((request) => request.method === "POST" && /tickets\//.test(request.url)).every((request) => /tickets\/(project-board|inspect|sprints\/list)$/.test(request.url))).toBe(true)
  })
}
