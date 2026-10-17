import { beforeEach, expect, it, vi } from "vitest"
import { ApiError, apiClient } from "@services/api"
import { readAssignmentSessionAccess } from "./assignmentSessions"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { get: vi.fn() } }))
const target = { assignment_id: "assignment", session_id: "session/one", run_id: "original-run" }
beforeEach(() => { vi.mocked(apiClient.get).mockReset() })
it("reads the exact encoded Session with an abortable GET and preserves its receipt tuple", async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ session: { id: target.session_id, kind: "child", project_id: "project" } })
  const signal = new AbortController().signal
  expect(await readAssignmentSessionAccess(target, "project", signal)).toEqual({ ...target, access: "accessible" })
  expect(apiClient.get).toHaveBeenCalledExactlyOnceWith("sessions/session%2Fone", { signal })
})
it.each([[403, "denied"], [404, "missing"], [503, "unknown"]] as const)("retains distinct access result for HTTP %s", async (status, access) => {
  vi.mocked(apiClient.get).mockRejectedValue(new ApiError("fixture", status, "fixture"))
  expect(await readAssignmentSessionAccess(target, "project", new AbortController().signal)).toEqual({ ...target, access })
})
it.each([{ id: "another", kind: "root", project_id: "project" }, { id: target.session_id, kind: "root", project_id: "foreign" }, { id: target.session_id, kind: "unverified" }])("does not enable an inconsistent Session observation %j", async (session) => {
  vi.mocked(apiClient.get).mockResolvedValue({ session })
  expect((await readAssignmentSessionAccess(target, "project", new AbortController().signal)).access).toBe("unknown")
})
it("does not treat a transport failure or an aborted read as accessible", async () => {
  const failure = new Error("fixture transport interrupted")
  vi.mocked(apiClient.get).mockRejectedValue(failure)
  expect((await readAssignmentSessionAccess(target, "project", new AbortController().signal)).access).toBe("unknown")
  const controller = new AbortController(); controller.abort()
  await expect(readAssignmentSessionAccess(target, "project", controller.signal)).rejects.toBe(failure)
})
