/// <reference types="node" />
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// These tests deliberately consume captured producer bytes without a frontend
// client, mocked transport, backend process, or invented HTTP response.
const directory = resolve(process.cwd(), "src/test/fixtures/sprintContract")
const read = (name: string) => readFileSync(resolve(directory, name))
const manifest = JSON.parse(read("manifest.json").toString())
const producer = JSON.parse(read("producer-http-payload.json").toString())
const capture = producer.requests_and_actual_responses
const workId = manifest.work_id
const keys = (value: object) => Object.keys(value).sort()
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

describe("frozen Sprint producer HTTP/serde capture", () => {
  it("retains the exact producer bytes and source identity", () => {
    expect(manifest.kind).toBe("isolated-real-actix-router-http-contract")
    expect(manifest.source_commit).toBe("b3a60a7f51b131b1f136ccb5fd78b2317f94a925")
    expect(manifest.source_tree).toBe("3bae5e25f941c82be73e63808ae3cdba269a0b72")
    expect(producer.source_sha).toBe(manifest.source_commit)
    expect(producer.source_tree).toBe(manifest.source_tree)
    expect(read(manifest.fixture).byteLength).toBe(manifest.original_payload_bytes)
    expect(hash(read(manifest.fixture))).toBe("064adc49ed5fac7d5cd428522645e4f88e2f319a4b96d4b269561f49537de19e")
    expect(manifest.sha256[manifest.fixture]).toBe(hash(read(manifest.fixture)))
    expect(manifest.producer_test_evidence.log_sha256).toBe(producer.log_sha256)
  })

  it("keeps actual router execution separate from unverified TCP, browser and other producer slices", () => {
    expect(manifest.producer_test_evidence).toMatchObject({
      exit_code: 0, source_unchanged: true, passed: 3, failed: 0, ignored: 0, filtered_out: 0,
    })
    expect(manifest.producer_test_evidence.test_summaries).toEqual([
      "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.66s",
    ])
    expect(manifest.captured_response_names).toEqual([
      "create_response", "list_response", "close_response", "inspect_response",
    ])
    expect(keys(capture).filter((name) => name.endsWith("_response")).sort())
      .toEqual([...manifest.captured_response_names].sort())
    expect(manifest.limitations).toContain(
      "No model or provider execution, TCP server, frontend browser or persisted Session navigation was exercised by this evidence.",
    )
    expect(manifest.limitations).toContain(
      "This Sprint result does not validate planning #2054 or Accept-stop-guard #2056 HTTP contracts.",
    )
  })

  it("uses bounded discovery summaries without member IDs or membership history", () => {
    expect(capture.list_request).toEqual({ project_id: manifest.project_id, limit: 10 })
    expect(capture.list_response.data).toHaveLength(1)
    const summary = capture.list_response.data[0]
    expect(keys(summary)).toEqual([
      "closure_counts", "created_seq", "definition", "id", "member_count",
      "project_id", "revision", "status", "updated_seq",
    ])
    expect(summary).toMatchObject({
      id: "a", project_id: manifest.project_id, status: "active", revision: 3,
      created_seq: 4, updated_seq: 6, member_count: 1, closure_counts: null,
    })
    expect(summary.definition).toEqual({
      name: "a", goal: "deliver verified Work", starts_at: null, ends_at: null,
    })
    expect(summary).not.toHaveProperty("members")
    expect(summary).not.toHaveProperty("history")
    expect(summary).not.toHaveProperty("current_counts")
  })

  it.each(["list_response", "inspect_response"])("preserves the full fixed read envelope for %s", (name) => {
    const response = capture[name]
    expect(keys(response)).toEqual([
      "coverage", "data", "index_seq", "next_cursor", "omitted_count", "snapshot", "truncated",
    ])
    expect(keys(response.snapshot)).toEqual(["authority_epoch", "commit", "seq"])
    expect(response).toMatchObject({
      coverage: "authoritative_scope", index_seq: response.snapshot.seq,
      next_cursor: null, omitted_count: 0, truncated: false,
    })
    expect(response.snapshot.authority_epoch).toBe(1)
    expect(response.snapshot.commit).toMatch(/^[a-f0-9]{64}$/)
  })

  it("ties close CAS to the exact active list snapshot and source Sprint revision", () => {
    const command = capture.close_request
    const list = capture.list_response
    expect(command).toMatchObject({
      expected_seq: list.snapshot.seq, expected_epoch: list.snapshot.authority_epoch,
      project_id: list.data[0].project_id, sprint_id: list.data[0].id,
      action: { op: "close", expected_revision: list.data[0].revision },
    })
    expect(keys(command)).toEqual([
      "action", "binding", "expected_epoch", "expected_seq", "operation_id", "project_id", "source", "sprint_id",
    ])
    expect(command.binding).toEqual(capture.create_request.binding)
    expect(command.binding).toMatchObject({
      scope_id: "supervisor/e9867fc0-7372-461b-bfed-1e7abeaa402c",
      supervisor_session_id: "bamboo-default-supervisor", binding_revision: 1,
    })
    expect(capture.inspect_response.snapshot.seq).toBe(command.expected_seq + 1)
    expect(capture.inspect_response.snapshot.commit).not.toBe(list.snapshot.commit)
  })

  it("retains separate current observations and immutable closing facts even when their values agree", () => {
    const { data, snapshot } = capture.inspect_response
    expect(keys(data)).toEqual(["current_counts", "current_members", "sprint"])
    expect(data.sprint.closure).toEqual(capture.close_response.closure)
    expect(data.sprint.closure.source_commit).toBe(capture.list_response.snapshot.commit)
    expect(data.sprint.closure.source_seq).toBe(capture.list_response.snapshot.seq)
    expect(data.sprint.closure.closed_seq).toBe(snapshot.seq)
    expect(data.current_counts).toEqual(data.sprint.closure.counts)
    expect(data.current_members[workId]).toEqual(data.sprint.closure.members[workId].version)
    // This real sample does not observe a later Work transition. Equal values
    // must not be relabelled as proof that the two projections cannot diverge.
    expect(manifest.limitations).toContain(
      "Current and closing counts happen to be equal in this capture; later divergence is a source contract, not an observed HTTP scenario here.",
    )
  })

  it("preserves closed membership and carried-out history instead of deleting historical Work", () => {
    const sprint = capture.inspect_response.data.sprint
    expect(sprint).toMatchObject({ status: "closed", revision: 4, created_seq: 4, updated_seq: 7 })
    expect(sprint.members).toEqual([workId])
    expect(keys(sprint.closure.members)).toEqual(sprint.members)
    expect(keys(capture.inspect_response.data.current_members)).toEqual(sprint.members)
    expect(sprint.history).toEqual([
      {
        work_id: workId, work_revision: 2, seq: 5, operation_id: "sprint-4",
        principal: "user:host-owner", source: "explicit owner request", change: { kind: "added" },
      },
      {
        work_id: workId, work_revision: 2, seq: 7, operation_id: "sprint-6",
        principal: "user:host-owner", source: "explicit owner request", change: { kind: "carried_out", to: null },
      },
    ])
  })

  it("distinguishes request destination tags from returned closing disposition tags", () => {
    expect(capture.close_request.action.dispositions).toEqual({ [workId]: { destination: "backlog" } })
    expect(capture.close_request.action.target_revisions).toEqual({})
    const closedMember = capture.close_response.closure.members[workId]
    expect(keys(closedMember)).toEqual(["disposition", "version"])
    expect(closedMember.disposition).toEqual({ disposition: "backlog" })
    expect(closedMember.disposition).not.toHaveProperty("destination")
    expect(capture.close_request.action.dispositions[workId]).not.toHaveProperty("disposition")
  })

  it("retains versioned canonical Work references without inventing completion or runtime facts", () => {
    const version = capture.close_response.closure.members[workId].version
    expect(keys(version)).toEqual([
      "accepted", "accepted_submission", "active_assignment", "archived", "blocked_resume_state",
      "context_hash", "contract_revision", "current_submission", "generation", "paused", "record_revision", "state",
    ])
    expect(version).toEqual({
      accepted: false, accepted_submission: null, active_assignment: null, archived: false,
      blocked_resume_state: null, context_hash: null, contract_revision: 1, current_submission: null,
      generation: 0, paused: false, record_revision: 2, state: "draft",
    })
    expect(capture.inspect_response.data.current_members[workId]).toEqual(version)
    expect(version).not.toHaveProperty("process_stopped")
    expect(version).not.toHaveProperty("heartbeat")
  })

  it("keeps unfinished and acceptance counts truthful for the captured draft Work", () => {
    const counts = { accepted: 0, blocked: 0, cancelled: 0, pending_acceptance: 0, total: 1, unfinished: 1 }
    expect(capture.close_response.closure.counts).toEqual(counts)
    expect(capture.inspect_response.data.current_counts).toEqual(counts)
    expect(capture.close_response.closure.members[workId].version.accepted).toBe(false)
    expect(capture.close_response.closure.members[workId].disposition.disposition).toBe("backlog")
  })

  it("normalizes omitted nullable definition dates in the producer canonical create receipt", () => {
    const request = capture.create_request
    expect(request.action).toEqual({ op: "create", definition: { name: "a", goal: "deliver verified Work" } })
    expect(request.action).not.toHaveProperty("expected_revision")
    const [domain, canonical] = JSON.parse(capture.create_response.operation.canonical_request)
    expect(domain).toBe("sprint")
    expect(canonical).toEqual({
      ...request,
      action: { ...request.action, definition: { ...request.action.definition, starts_at: null, ends_at: null } },
    })
    expect(capture.create_response.closure).toBeNull()
  })

  it("retains the complete exact close request inside the shared operation receipt", () => {
    expect(JSON.parse(capture.close_response.operation.canonical_request)).toEqual(["sprint", capture.close_request])
    expect(capture.close_response.closure).toMatchObject({ source_seq: 6, closed_seq: 7 })
    expect(capture.close_response.closure.counts.accepted).toBe(0)
  })

  it.each(["create", "close"])("binds the %s receipt to its canonical payload and committed scope sequence", (kind) => {
    const request = capture[`${kind}_request`]
    const operation = capture[`${kind}_response`].operation
    expect(keys(operation)).toEqual([
      "canonical_request", "committed_seq", "ids", "operation_id", "principal", "request_hash",
    ])
    expect(operation).toMatchObject({
      operation_id: request.operation_id, principal: "user:host-owner",
      committed_seq: request.expected_seq + 1, ids: { sprint: request.sprint_id },
    })
    expect(hash(operation.canonical_request)).toBe(operation.request_hash)
  })

  it("keeps the additive board filter examples distinct from uncaptured board response bodies", () => {
    expect(capture.board_filter_examples).toEqual([{ kind: "backlog" }, { kind: "sprint", sprint_id: "a" }])
    expect(manifest.board_filter_examples_kind).toBe("request-shape-examples-in-producer-capture-not-captured-board-responses")
    expect(capture).not.toHaveProperty("board_response")
    expect(capture).not.toHaveProperty("board_next_response")
  })
})
