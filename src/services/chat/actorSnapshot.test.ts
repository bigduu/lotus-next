import { beforeEach, describe, expect, it, vi } from "vitest"
import { actorSnapshotFixture } from "@/test/fixtures/actorSnapshot"
import { ACTOR_SNAPSHOT_MAX_BYTES, actorSnapshotRegresses, actorSnapshotTree, actorTreeCursorCovers, getActorSnapshot, parseActorSnapshot } from "./actorSnapshot"

const treeCursor = (revision: number, scope = "a".repeat(64)) => `at1-${scope}-${revision}`

const api = vi.hoisted(() => ({ fetchRaw: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: api }))
beforeEach(() => { api.fetchRaw.mockReset() })

describe("authorized actor snapshot DTO", () => {
  it("preserves opaque identity and per-actor revisions without inventing event authority", () => {
    const source = actorSnapshotFixture()
    const parsed = parseActorSnapshot(source, "root")
    expect(parsed).toEqual(source); expect(parsed).not.toBe(source)
    expect(parsed.nodes[1]).not.toBe(source.nodes[1])
    const tree = actorSnapshotTree(parsed)
    expect(Object.keys(tree.byId)).toHaveLength(129)
    expect(tree.byId["actor-64"].depth).toBe(3)
    expect(tree.byId["actor-1"]).toMatchObject({ lifecycle: "unknown", placement: "unknown", health: null, queuedCount: null, waitingForCount: null, pendingRequestCount: null })
    expect(tree).not.toHaveProperty("revision")
    expect(tree.byId["actor-0"]).not.toHaveProperty("sequence")
    expect(tree.byId["actor-0"]).toMatchObject({ lifecycle: "active", placement: "remote", health: null })
  })

  it("accepts a canonical durable tree cursor and orders complete views independently of snapshot_id", () => {
    const first = parseActorSnapshot(actorSnapshotFixture("root", 1, treeCursor(7)), "root")
    const second = parseActorSnapshot(actorSnapshotFixture("root", 0, treeCursor(8)), "root")
    expect(first.stream_cursor).toBe(treeCursor(7))
    expect(second.snapshot_id).toBe(first.snapshot_id)
    expect(actorSnapshotRegresses(first, second)).toBe(false)
    expect(actorSnapshotRegresses(second, first)).toBe(true)
    expect(actorTreeCursorCovers(treeCursor(8), treeCursor(7))).toBe(true)
    expect(actorTreeCursorCovers(treeCursor(7), treeCursor(8))).toBe(false)
    expect(actorTreeCursorCovers(treeCursor(8, "b".repeat(64)), treeCursor(7))).toBe(false)
    expect(actorTreeCursorCovers(null, treeCursor(7))).toBe(false)
  })

  it.each(["at1-" + "a".repeat(64) + "-0", "at1-" + "a".repeat(64) + "-01",
    "at1-" + "A".repeat(64) + "-1", "at1-" + "a".repeat(64) + "-9007199254740992",
    "at1-" + "a".repeat(63) + "-1", "at2-" + "a".repeat(64) + "-1"])(
    "rejects a malformed or unsafe tree cursor %s", (cursor) => {
      expect(() => parseActorSnapshot(actorSnapshotFixture("root", 0, cursor), "root")).toThrow("代理结构响应无效")
    },
  )

  it("validates a complete non-root subtree without treating selectors as authority", () => {
    const source = actorSnapshotFixture()
    source.subtree_actor_id = "actor-8"
    source.nodes = source.nodes.filter((node) => node.actor_id === "actor-8" || node.parent_actor_id === "actor-8")
    expect(parseActorSnapshot(source, "root", "actor-8").nodes).toHaveLength(65)
    expect(() => parseActorSnapshot(source, "root", "actor-0")).toThrow()
  })

  it("rejects a non-root subtree whose excluded parent points back into its descendants", () => {
    const source = actorSnapshotFixture()
    source.subtree_actor_id = "actor-8"
    source.nodes = source.nodes.filter((node) => node.actor_id === "actor-8" || node.parent_actor_id === "actor-8")
    source.nodes[0].parent_actor_id = "actor-64"
    expect(() => parseActorSnapshot(source, "root", "actor-8")).toThrow("代理结构响应无效")
  })

  it("bounds Unicode scalar titles and UTF-8 actor IDs independently", () => {
    const source = actorSnapshotFixture("根".repeat(85), 0)
    source.nodes[0].title = "😀".repeat(160)
    expect(parseActorSnapshot(source, source.root_actor_id).nodes[0].title).toBe(source.nodes[0].title)
    expect(() => parseActorSnapshot(source, "根".repeat(86))).toThrow()
  })

  it.each([
    "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",
    "{AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA}", "urn:uuid:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  ])("preserves producer-accepted UUID identity %s", (id) => {
    const source = actorSnapshotFixture()
    source.nodes[1].activation = { activation_id: id, attempt: 1, status: "running" }
    expect(parseActorSnapshot(source, "root").nodes[1].activation?.activation_id).toBe(id)
  })

  it.each([
    ["schema", (source: any) => { source.schema_version = 2 }],
    ["root binding", (source: any) => { source.root_actor_id = "foreign" }],
    ["subtree binding", (source: any) => { source.subtree_actor_id = "actor-0" }],
    ["malformed tree cursor", (source: any) => { source.stream_cursor = "cursor" }],
    ["empty identity", (source: any) => { source.snapshot_id = "" }],
    ["malformed identity", (source: any) => { source.snapshot_id = "as1-not-a-hash" }],
    ["identity suffix", (source: any) => { source.snapshot_id += "\n" }],
    ["malformed activation UUID", (source: any) => { source.nodes[1].activation.activation_id = "activation-one" }],
    ["UUID suffix", (source: any) => { source.nodes[1].activation.activation_id += "\n" }],
    ["malformed braced UUID", (source: any) => { source.nodes[1].activation.activation_id = "{aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa}" }],
    ["unsupported UUID prefix", (source: any) => { source.nodes[1].activation.activation_id = "URN:UUID:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    ["protected root field", (source: any) => { source.broker_token = "secret" }],
    ["protected node field", (source: any) => { source.nodes[0].tool_body = "secret" }],
    ["protected activation field", (source: any) => { source.nodes[1].activation.worker_endpoint = "secret" }],
    ["duplicate actor", (source: any) => { source.nodes.push(source.nodes[0]) }],
    ["foreign actor", (source: any) => { source.nodes[1].root_actor_id = "foreign" }],
    ["missing parent", (source: any) => { source.nodes[1].parent_actor_id = "missing" }],
    ["wrong depth", (source: any) => { source.nodes[1].depth = 5 }],
    ["wrong role", (source: any) => { source.nodes[1].role = "root" }],
    ["cycle", (source: any) => { source.nodes[1].parent_actor_id = "actor-8" }],
    ["unsafe revision", (source: any) => { source.nodes[0].revision.session_metadata_version = Number.MAX_SAFE_INTEGER + 1 }],
    ["invented zero directory", (source: any) => { source.nodes[0].revision.actor_directory_revision = 0 }],
    ["invented activation", (source: any) => { source.nodes[1].revision.actor_directory_revision = null }],
    ["unsupported lifecycle", (source: any) => { source.nodes[1].logical_state = "online" }],
    ["wrong placement enum", (source: any) => { source.nodes[1].placement_class = "container" }],
    ["too many nodes", (source: any) => { source.nodes = actorSnapshotFixture("root", 256).nodes }],
    ["empty subtree", (source: any) => { source.nodes = [] }],
    ["long title", (source: any) => { source.nodes[0].title = "x".repeat(161) }],
    ["control title", (source: any) => { source.nodes[0].title = "unsafe\n" }],
    ["non-scalar title", (source: any) => { source.nodes[0].title = "\ud800" }],
  ])("rejects %s instead of rendering partial success", (_name, corrupt) => {
    const source = actorSnapshotFixture(); corrupt(source)
    expect(() => parseActorSnapshot(source, "root")).toThrow("代理结构响应无效")
  })
})

describe("snapshot transport", () => {
  it("uses the shared authenticated client with explicit selectors, cancellation and no cache", async () => {
    const controller = new AbortController()
    api.fetchRaw.mockResolvedValue(new Response(JSON.stringify(actorSnapshotFixture("root ?")), { headers: { "Content-Type": "application/json" } }))
    await getActorSnapshot("root ?", "root ?", controller.signal)
    expect(api.fetchRaw).toHaveBeenCalledExactlyOnceWith("actors/root%20%3F/snapshot?subtree_id=root+%3F", { signal: controller.signal, cache: "no-store" })
  })
  it("cancels oversized streaming bodies before JSON decoding", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(ACTOR_SNAPSHOT_MAX_BYTES + 1)) }, cancel })
    api.fetchRaw.mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json" } }))
    await expect(getActorSnapshot("root")).rejects.toThrow("代理结构响应无效")
    expect(cancel).toHaveBeenCalledOnce()
  })
  it.each(["text/html", "application/json"])("fails closed on malformed %s bodies", async (contentType) => {
    api.fetchRaw.mockResolvedValue(new Response("bad response", { headers: { "Content-Type": contentType } }))
    await expect(getActorSnapshot("root")).rejects.toThrow("代理结构响应无效")
  })
  it("does not turn unsupported or unauthorized responses into an empty tree", async () => {
    const failure = new Error("HTTP rejected")
    api.fetchRaw.mockRejectedValue(failure)
    await expect(getActorSnapshot("root")).rejects.toBe(failure)
  })
})
