import { describe, expect, it, vi } from "vitest"
import { ApiError, NetworkRequestError, RequestTimeoutError } from "@services/api/errors"
import type { ProjectManifest } from "@services/project/types"
import { NewChatWorktreePreparation } from "./newChatWorktreePreparation"

const selection = { repository: "/repo", root: "/trees", name: "task", branch: "task-branch" }
const path = "/trees/task"
// Real Bamboo omits workspace_bindings when empty. Keep this fixture omitted.
function project(revision = 1, bound = false): ProjectManifest {
  return { id: "p1", status: "active", revision, project_path: "/repo",
    ...(bound ? { workspace_bindings: [{ path }] } : {}),
  } as ProjectManifest
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function setup(projectId: string | null = "p1") {
  const dependencies = {
    getProject: vi.fn().mockResolvedValue(project()),
    create: vi.fn().mockResolvedValue({ path }),
    bindWorkspace: vi.fn().mockResolvedValue(project(2, true)),
  }
  const ledger = new NewChatWorktreePreparation(projectId, vi.fn(), dependencies)
  ledger.select(selection)
  return { ledger, ...dependencies }
}

describe("new-chat worktree preparation", () => {
  it("creates once with frozen config, tolerates omitted bindings, and binds using a fresh revision", async () => {
    const context = setup()
    context.getProject.mockResolvedValueOnce(project(1)).mockResolvedValueOnce(project(7))
    await expect(context.ledger.prepare(() => true)).resolves.toBe(path)
    expect(context.create).toHaveBeenCalledExactlyOnceWith("p1", selection)
    expect(context.bindWorkspace).toHaveBeenCalledExactlyOnceWith("p1", 7, { path })
    expect(context.ledger.path).toBe(path)
    expect(context.ledger.locked).toBe(true)
    context.ledger.select(null)
    expect(context.ledger.selection).toEqual(selection)
  })

  it("keeps the acknowledged path after binding failure and retries binding only with refreshed CAS", async () => {
    const context = setup()
    context.getProject.mockResolvedValueOnce(project(1)).mockResolvedValueOnce(project(2)).mockResolvedValueOnce(project(9))
    context.bindWorkspace.mockRejectedValueOnce(new ApiError("stale revision", 409, "Conflict"))
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "failed" })
    expect(context.ledger.path).toBe(path)
    await expect(context.ledger.prepare(() => true)).resolves.toBe(path)
    expect(context.create).toHaveBeenCalledTimes(1)
    expect(context.bindWorkspace).toHaveBeenNthCalledWith(2, "p1", 9, { path })
  })

  it("reconciles a binding whose response was lost using the exact acknowledged path", async () => {
    const context = setup()
    context.bindWorkspace.mockRejectedValueOnce(new RequestTimeoutError())
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "failed" })
    context.getProject.mockResolvedValue(project(8, true))
    await expect(context.ledger.prepare(() => true)).resolves.toBe(path)
    expect(context.create).toHaveBeenCalledTimes(1)
    expect(context.bindWorkspace).toHaveBeenCalledTimes(1)
  })

  it.each([
    new RequestTimeoutError(), new NetworkRequestError(),
    new ApiError("checkout failed after git worktree add", 400, "Bad Request"),
    new ApiError("server failed", 500, "Server Error"),
  ])("fails closed after any dispatched creation error (%s), never retries or unlocks", async (failure) => {
    const context = setup()
    context.create.mockRejectedValue(failure)
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "uncertain" })
    expect(context.ledger.uncertain).toBe(true)
    expect(context.ledger.locked).toBe(true)
    context.ledger.select({ ...selection, name: "another" })
    expect(context.ledger.selection).toEqual(selection)
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "uncertain" })
    expect(context.create).toHaveBeenCalledTimes(1)
    expect(context.getProject).toHaveBeenCalledTimes(1)
    expect(context.bindWorkspace).not.toHaveBeenCalled()
  })

  it("does not adopt a matching manifest binding after an unknown create response", async () => {
    const context = setup()
    context.create.mockResolvedValue({})
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "uncertain" })
    context.getProject.mockResolvedValue(project(10, true))
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "uncertain" })
    expect(context.ledger.path).toBeNull()
    expect(context.bindWorkspace).not.toHaveBeenCalled()
  })

  it.each([null, ""]) ("validates Project before requests (%s)", async (id) => {
    const context = setup(id)
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "invalid" })
    expect(context.getProject).not.toHaveBeenCalled()
    expect(context.create).not.toHaveBeenCalled()
    expect(context.ledger.locked).toBe(false)
  })

  it("keeps incomplete local configuration editable and allows corrected submission", async () => {
    const context = setup()
    context.ledger.select({ ...selection, branch: " " })
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "invalid" })
    expect(context.create).not.toHaveBeenCalled()
    expect(context.ledger.locked).toBe(false)
    context.ledger.select(selection)
    await expect(context.ledger.prepare(() => true)).resolves.toBe(path)
  })

  it.each([
    { name: "../bad" }, { name: "bad/name" }, { name: "a".repeat(81) },
    { root: "" }, { root: "relative/path" }, { root: "~/trees" }, { root: "C:relative" }, { root: "/bad\0path" },
    { root: "/bad\npath" }, { branch: "HEAD" }, { branch: "-option" },
  ])("rejects obvious invalid config locally (%j) and remains editable", async (invalid) => {
    const context = setup()
    context.ledger.select({ ...selection, ...invalid })
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "invalid" })
    expect(context.getProject).not.toHaveBeenCalled()
    expect(context.create).not.toHaveBeenCalled()
    expect(context.ledger.locked).toBe(false)
    context.ledger.select(selection)
    await expect(context.ledger.prepare(() => true)).resolves.toBe(path)
  })

  it("requires the authoritative selected active Project", async () => {
    const context = setup()
    context.getProject.mockResolvedValue({ ...project(), id: "different" })
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "invalid" })
    expect(context.create).not.toHaveBeenCalled()
  })

  it("does not accept an unconfirmed binding response", async () => {
    const context = setup()
    context.bindWorkspace.mockResolvedValue(project(3))
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "failed" })
    expect(context.ledger.path).toBe(path)
  })

  it("locks synchronously before awaits and refuses duplicate preparation", async () => {
    const context = setup()
    const reading = deferred<ProjectManifest>()
    context.getProject.mockReturnValueOnce(reading.promise)
    const first = context.ledger.prepare(() => true)
    expect(context.ledger.busy).toBe(true)
    await expect(context.ledger.prepare(() => true)).rejects.toMatchObject({ kind: "failed" })
    reading.resolve(project())
    await expect(first).resolves.toBe(path)
    expect(context.create).toHaveBeenCalledTimes(1)
  })

  it("stops before mutation when context changes during the Project read", async () => {
    const context = setup()
    const reading = deferred<ProjectManifest>()
    context.getProject.mockReturnValueOnce(reading.promise)
    let current = true
    const pending = context.ledger.prepare(() => current)
    current = false
    reading.resolve(project())
    await expect(pending).rejects.toMatchObject({ kind: "context-changed" })
    expect(context.create).not.toHaveBeenCalled()
  })

  it("records a create ACK after navigation but never binds the stale context", async () => {
    const context = setup()
    const creating = deferred<{ path: string }>()
    context.create.mockReturnValue(creating.promise)
    let current = true
    const pending = context.ledger.prepare(() => current)
    await vi.waitFor(() => expect(context.create).toHaveBeenCalledTimes(1))
    current = false
    creating.resolve({ path })
    await expect(pending).rejects.toMatchObject({ kind: "context-changed" })
    expect(context.ledger.path).toBe(path)
    expect(context.ledger.locked).toBe(true)
    expect(context.bindWorkspace).not.toHaveBeenCalled()
    await expect(context.ledger.prepare(() => true)).resolves.toBe(path)
    expect(context.create).toHaveBeenCalledTimes(1)
  })

  it("does not return a ready path if context changed during binding", async () => {
    const context = setup()
    const binding = deferred<ProjectManifest>()
    context.bindWorkspace.mockReturnValueOnce(binding.promise)
    let current = true
    const pending = context.ledger.prepare(() => current)
    await vi.waitFor(() => expect(context.bindWorkspace).toHaveBeenCalledTimes(1))
    current = false
    binding.resolve(project(3, true))
    await expect(pending).rejects.toMatchObject({ kind: "context-changed" })
    expect(context.ledger.path).toBe(path)
  })
})
