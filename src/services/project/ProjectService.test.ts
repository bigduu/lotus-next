import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  request: vi.fn(),
}))

vi.mock("@services/api", () => ({ apiClient: api, isApiError: (e: { status?: number }) => typeof e === "object" && e !== null && "status" in e }))

import { projectService } from "./ProjectService"

const ok = <T,>(value: T) => Promise.resolve(value)

describe("ProjectService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists projects via GET projects", async () => {
    api.get.mockReturnValueOnce(ok({ projects: [] }))
    await projectService.listProjects()
    expect(api.get).toHaveBeenCalledWith("projects", expect.anything())
  })

  it("sends If-Match CAS headers on patch", async () => {
    api.patch.mockReturnValueOnce(ok({}))
    await projectService.patchProject("p1", 7, { name: "Renamed" })
    expect(api.patch).toHaveBeenCalledWith(
      "projects/p1",
      { name: "Renamed" },
      expect.objectContaining({ headers: { "If-Match": '"7"' } }),
    )
  })

  it("unbinds a workspace via DELETE with a JSON body", async () => {
    api.request.mockReturnValueOnce(ok({}))
    await projectService.unbindWorkspace("p1", 9, { path: "/tmp/w" })
    expect(api.request).toHaveBeenCalledWith(
      "DELETE",
      "projects/p1/workspaces",
      expect.objectContaining({
        headers: { "If-Match": '"9"' },
        body: JSON.stringify({ path: "/tmp/w" }),
      }),
    )
  })
})
