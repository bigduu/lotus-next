import { expect, it, vi } from "vitest"
const api = vi.hoisted(() => ({ get: vi.fn(), putOnce: vi.fn(), postOnce: vi.fn() }))
vi.mock("../api", () => ({ apiClient: api }))
import { worktreeService } from "./WorktreeService"
it("uses the authenticated API and keeps explicit locations in create requests", async () => {
  await worktreeService.preferences()
  await worktreeService.saveRoot("/Volumes/External/worktrees")
  await worktreeService.saveRoot(null, "project-a")
  await worktreeService.list("project/a")
  const request = { repository: "/repo", root: "/Volumes/External/worktrees", name: "task", branch: "feature/task" }
  await worktreeService.create("project/a", request)
  expect(api.get).toHaveBeenCalledWith("worktrees/preferences")
  expect(api.putOnce).toHaveBeenCalledWith("worktrees/preferences", { root: "/Volumes/External/worktrees" })
  expect(api.putOnce).toHaveBeenCalledWith("worktrees/preferences", { root: null, project_id: "project-a" })
  expect(api.get).toHaveBeenCalledWith("projects/project%2Fa/worktrees")
  expect(api.postOnce).toHaveBeenCalledWith("projects/project%2Fa/worktrees", request)
})
