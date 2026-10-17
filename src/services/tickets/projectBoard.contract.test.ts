/// <reference types="node" />
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { boardCountsKnown, projectBoardClient, type ProjectBoardPage } from "./projectBoard"

vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { post: vi.fn() } }))
const directory = resolve(process.cwd(), "src/test/fixtures/projectWorkBoardContract")
const read = (name: string) => readFileSync(resolve(directory, name))
const manifest = JSON.parse(read("manifest.json").toString())
const capture = (name: string) => JSON.parse(read(name).toString())
beforeEach(() => vi.resetAllMocks())

it("retains the exact synthetic Bamboo HTTP/serde response bytes and provenance", () => {
  expect(manifest.kind).toBe("synthetic-real-http-serde-contract")
  expect(manifest.source_commit).toBe("41a56acaec2ebc27aa8961a4f6d6023a2c695268")
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    expect(createHash("sha256").update(read(file)).digest("hex")).toBe(expected)
  }
})

it("consumes real serialized pagination while preserving exact counts including hidden cancelled Work", async () => {
  const first = capture("board-first.json") as ProjectBoardPage
  const second = capture("board-second.json") as ProjectBoardPage
  // Capture requests use limit=1 to exercise two real pages. Production asks
  // for up to 100; replay here validates response consumption, not a live call.
  expect(manifest.requests.first.limit).toBe(1)
  vi.mocked(apiClient.post).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const loaded = await projectBoardClient.page(manifest.project_id, false)
  expect(loaded.truncated).toBe(true)
  expect(loaded.omitted_count).toBe(1)
  expect(boardCountsKnown(loaded)).toBe(true)
  expect(loaded.data.counts).toMatchObject({ todo: 2, cancelled: 1, total: 3 })
  expect(loaded.data.rows[0].context?.workspace_binding.path).toBeTruthy()
  expect(loaded.data.rows[0].adopted_context).toBeNull()
  const complete = await projectBoardClient.page(manifest.project_id, false, loaded)
  expect(complete.data.rows).toHaveLength(2)
  expect(complete.next_cursor).toBeNull()
  expect(complete.data.rows.every((row) => row.ticket.state !== "cancelled")).toBe(true)
  expect(complete.data.counts).toEqual(first.data.counts)
  expect(apiClient.post).toHaveBeenLastCalledWith("tickets/project-board", expect.objectContaining({
    project_id: manifest.project_id, include_cancelled: false,
    cursor: manifest.requests.second.cursor, fixed_commit: manifest.requests.second.fixed_commit,
  }), { signal: undefined })
})

it("consumes the real single-ID pinned inspector without inventing assignment or evidence", async () => {
  const id = manifest.requests.inspect.ids[0]
  vi.mocked(apiClient.post).mockResolvedValue(capture("inspect.json"))
  const view = await projectBoardClient.inspect(id, manifest.snapshot)
  expect(view.ticket.id).toBe(id)
  expect(view.assignments).toEqual([])
  expect(view.submissions).toEqual([])
  expect(apiClient.post).toHaveBeenCalledWith("tickets/inspect", manifest.requests.inspect, { signal: undefined })
})
