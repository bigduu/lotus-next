import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const projectId = "workflow-project"
const workflowId = "inspect-file"
const date = "2026-09-03T00:00:00.000Z"
const definitionDigest = "a".repeat(64)
const skillDigest = "b".repeat(64)
const revisionOne = {
  workflow_schema: 1, id: workflowId, revision: 1,
  input_schema: { type: "object", additionalProperties: true },
  steps: [{ id: "inspect", type: "tool", tool: "Read", args: { file_path: "README.md" }, capabilities: ["read"] }],
  plan: { type: "step", step: "inspect" },
}
const revisionTwo = {
  ...revisionOne, revision: 2,
  steps: [{ ...revisionOne.steps[0], args: { file_path: "AGENTS.md" } }],
}
const description = "Read README.md for project guidance"
const revisedDescription = "Read AGENTS.md for project guidance"
const catalogEntry = (revision: number) => ({
  id: workflowId, name: workflowId, description: revision === 2 ? revisedDescription : description,
  source: "project", kind: "orchestration", revision, status: "valid", winner: true,
  invocation_policy: { explicit: true, automatic: false }, argument_schema: revisionOne.input_schema,
})
const session = {
  id: sessionId, title: "Workflow teaching", kind: "root", root_session_id: sessionId, project_id: projectId,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: date, updated_at: date, last_activity_at: date, message_count: 0,
  is_running: false, last_run_status: "completed", has_pending_question: false, permission_mode: "default",
}

test("project workflow teaching previews and saves a revision, then selects the exact version to run", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const proposals: unknown[] = []
  const writes: unknown[] = []
  const executions: unknown[] = []
  let saved = 0
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    const method = route.request().method()
    const scope = `/api/v1/sessions/${sessionId}`
    if (pathname === "/api/v1/sessions") return route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } })
    if (pathname === scope) return route.fulfill({ json: { session } })
    if (pathname === "/api/v1/bamboo/workflow-catalog") {
      return route.fulfill({ json: { revision: saved + 1, entries: saved ? [catalogEntry(saved)] : [] } })
    }
    if (pathname === `${scope}/workflow-proposals` && method === "POST") {
      proposals.push(route.request().postDataJSON())
      return route.fulfill({ status: 202, json: { run_id: `draft-${proposals.length}`, session_id: sessionId, status: "queued" } })
    }
    if (pathname.startsWith(`${scope}/workflow-proposals/draft-`)) {
      const runId = pathname.split("/").at(-1)
      const editing = runId === "draft-2"
      return route.fulfill({ json: { run_id: runId, session_id: sessionId, status: "succeeded",
        result: { decision: "draft", project_id: projectId, description: editing ? revisedDescription : description,
          definition: editing ? revisionTwo : revisionOne,
          base: editing ? { definition: revisionOne, description, content_digest: definitionDigest, skill_digest: skillDigest } : null },
      } })
    }
    if (pathname.startsWith("/api/v1/bamboo/workflow-definitions") && (method === "POST" || method === "PUT")) {
      const request = route.request().postDataJSON()
      writes.push(request)
      saved = request.definition.revision
      return route.fulfill({ status: method === "POST" ? 201 : 200, json: { saved: true, source: "project",
        catalog_available: true, definition: request.definition, description: request.description } })
    }
    const run = { run_id: "published-run", session_id: sessionId, workflow_id: workflowId, workflow_revision: 2,
      status: "succeeded", can_cancel: false, last_sequence: 1, steps: {},
      budget: { max_steps: 4, max_retries: 0, max_agents: 0, wall_time_ms: 1000 },
      usage: { steps: 1, retries: 0, agents: 0, tokens: 0, cost_micros: null }, child_agent_count: 0, created_at: date, updated_at: date }
    if (pathname === `${scope}/workflow-runs` && method === "POST") {
      executions.push(route.request().postDataJSON())
      return route.fulfill({ status: 202, json: run })
    }
    if (pathname === `${scope}/workflow-runs`) return route.fulfill({ json: executions.length ? [run] : [] })
    if (pathname === `${scope}/workflow-runs/published-run`) return route.fulfill({ json: run })
    if (pathname === `${scope}/workflow-runs/published-run/events`) return route.fulfill({ json: [] })
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("banner").getByRole("button", { name: "更多", exact: true }).click()
  await page.getByRole("menuitem", { name: "编排运行", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "编排运行", exact: true })
  const teach = dialog.getByRole("button", { name: "教一个工作流", exact: true })
  const instruction = dialog.getByRole("textbox", { name: "这个工作流应该怎么做？", exact: true })
  const generate = dialog.getByRole("button", { name: "生成草稿", exact: true })
  const save = dialog.getByRole("button", { name: "保存到项目", exact: true })
  const selectRun = dialog.getByRole("button", { name: "在编排运行中选择", exact: true })

  await teach.click()
  await instruction.fill("以后读取 README.md")
  await generate.click()
  await expect(dialog.getByRole("list", { name: "提案步骤" })).toContainText("Read")
  expect(writes).toHaveLength(0)
  await save.click()
  await expect(dialog).toContainText("版本 1 已保存到项目。")
  await selectRun.click()
  await expect(dialog.getByRole("combobox")).toHaveValue(`project:${workflowId}:1`)

  await teach.click()
  await dialog.getByRole("combobox", { name: "教学目标", exact: true }).selectOption(workflowId)
  await instruction.fill("以后改为读取 AGENTS.md")
  await generate.click()
  await expect(dialog).toContainText("r1 → r2")
  await expect(dialog.getByText(`r1 · ${description}`, { exact: true })).toBeVisible()
  await expect(dialog.getByText(`r2 · ${revisedDescription}`, { exact: true })).toBeVisible()
  await expect(dialog.getByRole("list", { name: "提案步骤" })).toContainText("已修改")
  await expect(dialog.getByRole("list", { name: "提案步骤" })).toContainText("README.md")
  await expect(dialog.getByRole("list", { name: "提案步骤" })).toContainText("AGENTS.md")
  await dialog.getByText("比较定义", { exact: true }).click()
  await expect(dialog.getByText(/"file_path": "README.md"/)).toBeVisible()
  await expect(dialog.getByText(/"file_path": "AGENTS.md"/)).toBeVisible()
  await testInfo.attach("workflow-revision-preview", { body: await dialog.screenshot(), contentType: "image/png" })
  expect(writes).toHaveLength(1)
  await save.click()
  await expect(dialog).toContainText("版本 2 已保存到项目。")
  expect(proposals).toEqual([{ instruction: "以后读取 README.md" }, { instruction: "以后改为读取 AGENTS.md", workflow_id: workflowId }])
  expect(writes).toEqual([
    { target: "project", session_id: sessionId, expected_project_id: projectId, description, definition: revisionOne },
    { target: "project", session_id: sessionId, expected_project_id: projectId, expected_revision: 1,
      expected_digest: definitionDigest, expected_skill_digest: skillDigest, description: revisedDescription, definition: revisionTwo },
  ])
  expect(executions).toEqual([])
  await selectRun.click()
  await expect(dialog.getByRole("combobox")).toHaveValue(`project:${workflowId}:2`)
  await expect(dialog.getByText(revisedDescription, { exact: true })).toBeVisible()
  await expect(dialog.getByText(description, { exact: true })).toHaveCount(0)
  await dialog.getByRole("button", { name: "启动运行", exact: true }).click()
  await expect(dialog).toContainText("published-run")
  expect(executions).toEqual([{ workflow_id: workflowId, revision: 2, args: {} }])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
