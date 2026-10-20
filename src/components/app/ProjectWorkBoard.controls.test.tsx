import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import type { ProjectManifest } from "@services/project"
import { projectBoardClient, type ProjectBoardPage } from "@services/tickets/projectBoard"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import { OwnerAccessContext } from "@/hooks/ownerAccessContext"
import { ProjectWorkBoard, type ProjectWorkBoardControls } from "./ProjectWorkBoard"
import { ownerProps, planningProps } from "./project-work/testFixtures"

vi.mock("@services/tickets/projectBoard", async (original) => ({ ...await original<typeof import("@services/tickets/projectBoard")>(), projectBoardClient: { page: vi.fn(), inspect: vi.fn() } }))
const project = { id: "project", name: "Project", revision: 1, resource_revision: 1, workspace_bindings: [] } as unknown as ProjectManifest
const page = (): ProjectBoardPage => {
  const fixture = ticketSnapshot()
  return { ...fixture.scope.overview, snapshot: { commit: "pinned-controls", seq: 19, authority_epoch: 4 }, data: {
    project_id: "project", counts: { todo: 0, doing: 1, testing: 0, done: 0, blocked: 0, cancelled: 0, total: 1 },
    rows: [{ ticket: { ...fixture.views[0].ticket, id: "work-1", scope_id: "scope-1", generation: 3,
      record_revision: 8, contract_revision: 5, state: "active", current_submission: "submission-1", depends_on: [] },
      stage: "doing", context: null, adopted_context: null }],
  } }
}
let root: Root
beforeEach(async () => {
  await changeLocale("en-US")
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  root = createRoot(document.body.appendChild(document.createElement("div")))
  vi.mocked(projectBoardClient.page).mockReset().mockResolvedValue(page())
  vi.mocked(projectBoardClient.inspect).mockReset().mockResolvedValue({ ticket: page().data.rows[0].ticket, assignments: [], requests: [], submissions: [] })
})
afterEach(() => act(() => root.unmount()))
async function render(controls?: ProjectWorkBoardControls, owner = true) {
  await act(async () => root.render(<OwnerAccessContext.Provider value={owner}><ProjectWorkBoard project={project} controls={controls} /></OwnerAccessContext.Provider>))
  if (owner) await act(async () => (document.querySelector('[data-testid="project-work-work-1"]') as HTMLButtonElement).click())
}
const button = (name: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === name)!

it("keeps the existing board read-only when no controlled host is supplied", async () => {
  await render()
  expect(document.querySelector('[data-testid="project-work-details"]')).not.toBeNull()
  expect(document.querySelector('[data-testid="project-work-planning-controls"]')).toBeNull()
  expect(document.querySelector('[data-testid="project-work-owner-controls"]')).toBeNull()
})
it("delivers a matching controlled draft with its original Work and scope CAS", async () => {
  const planning = planningProps()
  await render({ planning })
  expect(button("Request planning update").disabled).toBe(false)
  await act(async () => button("Request planning update").click())
  expect(planning.onSavePlanning).toHaveBeenCalledExactlyOnceWith({ priority: "high", expectedCompletionAt: "2026-10-19T09:15:00-07:00" }, planning.command)
  expect(planning.command?.recordRevision).toBe(8)
  expect(page().data.rows[0].ticket.state).toBe("active")
})
it.each(["generation", "recordRevision", "state"] as const)("does not mount stale %s controls on a newer canonical Work", async (field) => {
  const planning = planningProps()
  if (field === "state") planning.work.state = "ready"
  else planning.work[field] += 1
  await render({ planning })
  expect(document.querySelector('[data-testid="project-work-planning-controls"]')).toBeNull()
  expect(document.body.textContent).toContain("Refresh to obtain the authoritative binding and revision")
  expect(planning.onSavePlanning).not.toHaveBeenCalled()
  expect(planning.draft.priority).toBe("high")
})
it.each(["scope", "sequence", "epoch"])("disables commands outside the selected %s while retaining the draft", async (field) => {
  const planning = planningProps()
  const owner = ownerProps()
  owner.work.state = "active"
  const contexts = [planning.command!, ...Object.values(owner.commands)]
  for (const context of contexts) {
    if (field === "scope") context.binding.scope_id = "another-scope"
    else if (field === "sequence") context.expectedSeq += 1
    else context.expectedEpoch += 1
  }
  await render({ planning, owner })
  expect(button("Request planning update").disabled).toBe(true)
  expect(button("Request pause").disabled).toBe(true)
  await act(async () => button("Request planning update").click())
  expect(planning.onSavePlanning).not.toHaveBeenCalled()
  expect(owner.onRequestAction).not.toHaveBeenCalled()
  expect((document.querySelector('input[type="text"]') as HTMLInputElement).value).toBe(planning.draft.expectedCompletionAt)
})
it.each(["contractRevision", "currentSubmissionId"] as const)("rejects owner controls for an old %s", async (field) => {
  const owner = ownerProps()
  owner.work.state = "active"
  if (field === "contractRevision") owner.work.contractRevision += 1
  else owner.work.currentSubmissionId = "old-submission"
  await render({ owner })
  expect(document.querySelector('[data-testid="project-work-owner-controls"]')).toBeNull()
  expect(owner.onRequestAction).not.toHaveBeenCalled()
})
it("does not treat a supplied owner flag as verified owner access", async () => {
  const planning = planningProps()
  await render({ planning }, false)
  expect(projectBoardClient.page).not.toHaveBeenCalled()
  expect(document.querySelector('[data-testid="project-work-planning-controls"]')).toBeNull()
  expect(planning.onSavePlanning).not.toHaveBeenCalled()
})
