import { beforeEach, describe, expect, it, vi } from "vitest"
import { actorSnapshotFixture, actorSnapshotV2Fixture } from "@/test/fixtures/actorSnapshot"
import { ACTOR_SNAPSHOT_ACCEPT, ACTOR_SNAPSHOT_V2_MEDIA_TYPE, ACTOR_SNAPSHOT_MAX_BYTES, actorSnapshotRegresses, actorSnapshotTree, actorTreeCursorCovers, getActorSnapshot, parseActorSnapshot } from "./actorSnapshot"

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
    expect(tree.byId["actor-0"]).toMatchObject({ lifecycle: "running", placement: "remote", health: null })
  })

  it.each([
    ["active", "reserved", "queued"],
    ["active", "running", "running"],
    ["cold", "succeeded", "completed"],
    ["cold", "cancelled", "cancelled"],
    ["cold", null, "cold"],
    ["failed", "failed", "failed"],
    ["retired", "cancelled", "retired"],
  ])("shows durable %s/%s as %s without a live content subscription", (state, status, expected) => {
    const source = actorSnapshotFixture()
    Object.assign(source.nodes[1], {
      logical_state: state,
      placement_class: status === null ? null : "remote",
      activation: status === null ? null : {
        activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1, status,
      },
    })
    const tree = actorSnapshotTree(parseActorSnapshot(source, "root"))
    expect(tree.byId["actor-0"].lifecycle).toBe(expected)
  })

  it("reconciles a 129-node snapshot by reusing unchanged normalized actors", () => {
    const first = actorSnapshotTree(parseActorSnapshot(actorSnapshotFixture(), "root"))
    const unchanged = actorSnapshotTree(parseActorSnapshot(actorSnapshotFixture(), "root"), false, first)
    expect(unchanged).toBe(first)

    const moved = actorSnapshotFixture()
    moved.nodes[65].parent_actor_id = "actor-0"
    moved.nodes[65].depth = 2
    const next = actorSnapshotTree(parseActorSnapshot(moved, "root"), false, first)
    expect(next).not.toBe(first)
    expect(next.byId["actor-64"]).not.toBe(first.byId["actor-64"])
    expect(next.byId["actor-63"]).toBe(first.byId["actor-63"])
    expect(next.childrenById["actor-0"]).not.toBe(first.childrenById["actor-0"])
    expect(next.childrenById["actor-8"]).not.toBe(first.childrenById["actor-8"])
    expect(next.childrenById["root"]).toBe(first.childrenById["root"])

    const resumed = actorSnapshotFixture()
    Object.assign(resumed.nodes[1], {
      revision: { session_metadata_version: 7, actor_directory_revision: 3 },
      activation: { activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1, status: "reserved" },
    })
    const stateChanged = actorSnapshotTree(parseActorSnapshot(resumed, "root"), false, first)
    expect(stateChanged.byId["actor-0"].lifecycle).toBe("queued")
    expect(stateChanged.byId["actor-0"]).not.toBe(first.byId["actor-0"])
    expect(stateChanged.byId["actor-63"]).toBe(first.byId["actor-63"])
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

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "rejects a same-activation %s snapshot returning to Running after refresh", (status) => {
      const prior = parseActorSnapshot(actorSnapshotFixture("root", 1, treeCursor(7)), "root")
      prior.nodes[1].activation!.status = status
      const next = structuredClone(prior)
      next.stream_cursor = treeCursor(8)
      next.nodes[1].revision.session_metadata_version += 1
      next.nodes[1].revision.actor_directory_revision! += 1
      next.nodes[1].activation!.status = "running"
      expect(actorSnapshotRegresses(prior, next)).toBe(true)
    },
  )

  it("accepts a genuinely newer activation after a confirmed terminal snapshot", () => {
    const prior = parseActorSnapshot(actorSnapshotFixture("root", 1, treeCursor(7)), "root")
    prior.nodes[1].activation!.status = "succeeded"
    const next = structuredClone(prior)
    next.stream_cursor = treeCursor(8)
    next.nodes[1].revision.session_metadata_version += 1
    next.nodes[1].revision.actor_directory_revision! += 1
    next.nodes[1].activation = { activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 2, status: "running" }
    expect(actorSnapshotRegresses(prior, next)).toBe(false)
    expect(actorSnapshotRegresses(next, prior)).toBe(true)
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
    expect(api.fetchRaw).toHaveBeenCalledExactlyOnceWith("actors/root%20%3F/snapshot?subtree_id=root+%3F", { signal: controller.signal, cache: "no-store", headers: { Accept: ACTOR_SNAPSHOT_ACCEPT } })
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


describe("negotiated native task observations", () => {
  it.each(["running", "stopped", "stop_unconfirmed"] as const)("preserves strict %s evidence without making a business outcome", (state) => {
    const source = actorSnapshotV2Fixture(state)
    const parsed = parseActorSnapshot(source, "root")
    expect(parsed).toEqual(source)
    const tree = actorSnapshotTree(parsed)
    expect(tree.byId["actor-0"].lifecycle).toBe(state === "running" ? "running" : "unknown")
    expect(tree.byId["actor-0"].localTaskDiagnostic).toBe(state === "running" ? null : state)
    expect(parsed.nodes[1].activation?.status).toBe("running")
    expect(tree.byId["actor-0"]).not.toHaveProperty("canStop")
  })

  it.each([30_001, 60_000, 2_147_483_647])("accepts the full safe %i ms expiry hint", (delay) => {
    const source = actorSnapshotV2Fixture("running", "root", delay)
    expect(parseActorSnapshot(source, "root").refresh_after_ms).toBe(delay)
  })

  it("accepts native evidence with unknown concrete placement and with a local placement", () => {
    const source = actorSnapshotV2Fixture("stop_unconfirmed")
    expect(source.nodes[1].placement_class).toBeNull()
    expect(actorSnapshotTree(parseActorSnapshot(source, "root")).byId["actor-0"].placement).toBe("unknown")
    source.nodes[1].placement_class = "local"
    expect(actorSnapshotTree(parseActorSnapshot(source, "root")).byId["actor-0"].placement).toBe("local")
  })

  it("preserves a durable business outcome independently from native stop proof", () => {
    const source = actorSnapshotV2Fixture("stopped")
    source.nodes[1].logical_state = "cold"
    source.nodes[1].activation!.status = "succeeded"
    expect(actorSnapshotTree(parseActorSnapshot(source, "root")).byId["actor-0"].lifecycle).toBe("completed")
  })

  it.each([
    ["cold", "succeeded", "completed"], ["cold", "cancelled", "cancelled"],
    ["failed", "failed", "failed"], ["retired", "cancelled", "retired"],
  ] as const)("keeps %s/%s business outcome %s beside unconfirmed physical stop", (logical, activation, outcome) => {
    const source = actorSnapshotV2Fixture("stop_unconfirmed")
    source.nodes[1].logical_state = logical
    source.nodes[1].activation!.status = activation
    expect(actorSnapshotTree(parseActorSnapshot(source, "root")).byId["actor-0"]).toMatchObject({
      lifecycle: outcome, health: "unknown", localTaskDiagnostic: "stop_unconfirmed",
    })
  })

  it("clears old stop diagnostics on a successor while rejecting an older activation", () => {
    const old = actorSnapshotV2Fixture("stop_unconfirmed")
    const next = actorSnapshotV2Fixture()
    next.nodes[1].revision.actor_directory_revision = 3
    next.nodes[1].activation = { activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 2, status: "running" }
    const tree = actorSnapshotTree(next, false, actorSnapshotTree(old))
    expect(tree.byId["actor-0"]).toMatchObject({ lifecycle: "running", health: null, localTaskDiagnostic: null })
    expect(actorSnapshotRegresses(next, old)).toBe(true)
  })

  it.each([
    ["v1 extra diagnostic", (v: any) => { v.schema_version = 1; v.snapshot_id = `as1-${"a".repeat(64)}`; delete v.refresh_after_ms }],
    ["v2 old hash", (v: any) => { v.snapshot_id = `as1-${"a".repeat(64)}` }],
    ["missing hint", (v: any) => { delete v.refresh_after_ms }],
    ["short hint", (v: any) => { v.refresh_after_ms = 999 }],
    ["long hint", (v: any) => { v.refresh_after_ms = 2_147_483_648 }],
    ["fractional hint", (v: any) => { v.refresh_after_ms = 1_000.5 }],
    ["missing observation", (v: any) => { delete v.nodes[0].local_task }],
    ["private proof", (v: any) => { v.nodes[1].local_task.pid = 123 }],
    ["unknown state", (v: any) => { v.nodes[1].local_task.state = "cancelled" }],
    ["missing reason", (v: any) => { v.nodes[1].local_task.state = "stop_unconfirmed" }],
    ["unknown reason", (v: any) => { v.nodes[1].local_task.reason = "lost" }],
    ["false reason", (v: any) => { v.nodes[1].local_task.reason = "execution_stop_unconfirmed" }],
    ["foreign placement", (v: any) => { v.nodes[1].placement_class = "remote" }],
    ["no current activation", (v: any) => { v.nodes[1].activation = null }],
    ["root evidence", (v: any) => { v.nodes[0].local_task = v.nodes[1].local_task }],
    ["non-RFC timestamp", (v: any) => { v.nodes[1].local_task.observed_at = "2026-10-11" }],
    ["impossible date", (v: any) => { v.nodes[1].local_task.observed_at = "2026-02-30T09:00:00Z" }],
    ["invalid zone", (v: any) => { v.nodes[1].local_task.lease_expires_at = "2026-10-11T09:00:00+25:00" }],
  ])("rejects %s without rendering partial evidence", (_reason, corrupt) => {
    const source = actorSnapshotV2Fixture(); corrupt(source)
    expect(() => parseActorSnapshot(source, "root")).toThrow()
  })

  it("accepts stable lease expiry evidence without inferring stopped or cancelled", () => {
    const source = actorSnapshotV2Fixture("stop_unconfirmed")
    source.nodes[1].local_task!.reason = "lease_expired_without_stop"
    source.nodes[1].local_task!.observed_at = "2026-10-11T09:00:01.123456789+00:00"
    expect(actorSnapshotTree(parseActorSnapshot(source, "root")).byId["actor-0"].lifecycle).toBe("unknown")
  })

  it("reads a negotiated vendor response once and keeps old-host v1 compatibility", async () => {
    api.fetchRaw.mockResolvedValueOnce(new Response(JSON.stringify(actorSnapshotV2Fixture("stop_unconfirmed")), { headers: { "Content-Type": ACTOR_SNAPSHOT_V2_MEDIA_TYPE } }))
    expect((await getActorSnapshot("root")).schema_version).toBe(2)
    api.fetchRaw.mockResolvedValueOnce(new Response(JSON.stringify(actorSnapshotFixture()), { headers: { "Content-Type": "application/json" } }))
    expect((await getActorSnapshot("root")).schema_version).toBe(1)
    expect(api.fetchRaw).toHaveBeenCalledTimes(2)
  })

  it("never retries a rejected negotiation or malformed v2 through a v1 fallback", async () => {
    api.fetchRaw.mockRejectedValueOnce(new Error("HTTP 400"))
    await expect(getActorSnapshot("root")).rejects.toThrow("HTTP 400")
    expect(api.fetchRaw).toHaveBeenCalledOnce()
    api.fetchRaw.mockResolvedValueOnce(new Response(JSON.stringify({ ...actorSnapshotV2Fixture(), unknown: true }), { headers: { "Content-Type": ACTOR_SNAPSHOT_V2_MEDIA_TYPE } }))
    await expect(getActorSnapshot("root")).rejects.toThrow()
    expect(api.fetchRaw).toHaveBeenCalledTimes(2)
  })
})


describe("same-activation native evidence ordering", () => {
  it.each(["running", "stop_unconfirmed"] as const)("keeps confirmed stop evidence over stale %s or absent evidence", (state) => {
    const prior = actorSnapshotV2Fixture("stopped")
    expect(actorSnapshotRegresses(prior, actorSnapshotV2Fixture(state))).toBe(true)
    const missing = actorSnapshotV2Fixture()
    missing.nodes[1].local_task = null
    expect(actorSnapshotRegresses(prior, missing)).toBe(true)
    expect(actorSnapshotRegresses(prior, actorSnapshotV2Fixture("stopped"))).toBe(false)
  })

  it("never clears explicit unknown through a running lease, but accepts genuine stopped proof", () => {
    const prior = actorSnapshotV2Fixture("stop_unconfirmed")
    const live = actorSnapshotV2Fixture()
    live.nodes[1].local_task!.lease_expires_at = "2026-10-11T10:00:00Z"
    expect(actorSnapshotRegresses(prior, live)).toBe(true)
    expect(actorSnapshotRegresses(prior, actorSnapshotV2Fixture("stopped"))).toBe(false)
    const expired = actorSnapshotV2Fixture("stop_unconfirmed")
    expired.nodes[1].local_task!.reason = "lease_expired_without_stop"
    expect(actorSnapshotRegresses(prior, expired)).toBe(true)
  })

  it("accepts running after expiry only with a strictly later lease for that activation", () => {
    const prior = actorSnapshotV2Fixture("stop_unconfirmed")
    prior.nodes[1].local_task!.reason = "lease_expired_without_stop"
    const same = actorSnapshotV2Fixture()
    expect(actorSnapshotRegresses(prior, same)).toBe(true)
    same.nodes[1].local_task!.lease_expires_at = "2026-10-11T09:00:01.000000001Z"
    expect(actorSnapshotRegresses(prior, same)).toBe(false)
    expect(actorSnapshotRegresses(same, actorSnapshotV2Fixture())).toBe(true)
  })

  it("does not allow same-state evidence time to go backward", () => {
    const prior = actorSnapshotV2Fixture("stopped")
    prior.nodes[1].local_task!.observed_at = "2026-10-11T09:00:00.000000002Z"
    const old = actorSnapshotV2Fixture("stopped")
    old.nodes[1].local_task!.observed_at = "2026-10-11T10:00:00.000000001+01:00"
    expect(actorSnapshotRegresses(prior, old)).toBe(true)
    expect(actorSnapshotRegresses(old, prior)).toBe(false)
  })
})
