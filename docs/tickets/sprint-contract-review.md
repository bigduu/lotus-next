# Sprint producer contract review

This review uses Bamboo Draft [#2052](https://github.com/bigduu/Bamboo-agent/pull/2052), commit `b3a60a7f51b131b1f136ccb5fd78b2317f94a925`, tree `3bae5e25f941c82be73e63808ae3cdba269a0b72`. The source checkout was clean when read. No Rust compilation, server, provider, worker, or user configuration was started or changed by this frontend review.

`src/test/fixtures/sprintContract/producer-http-payload.json` is a byte-for-byte copy of the producer's `sprint-http-payload.json`: SHA-256 `064adc49ed5fac7d5cd428522645e4f88e2f319a4b96d4b269561f49537de19e`, 9865 bytes. `manifest.json` records source files and hashes, original receipt paths, and the scope of the existing producer test run. The producer's three actual Actix `configure_routes` tests passed with isolated temporary Jiandu and dispatch disabled. This is actual router execution without a TCP listener. It does not prove a browser connection, persisted Session navigation, provider execution, or planning #2054 / Accept guard #2056.

The capture contains actual create, list, close, and inspect bodies. Its board-filter objects are request-shape examples; actual board response bodies, paginated responses, edit/start/add/remove response bodies, and later current-vs-closure divergence were not captured. The frontend tests only read the captured fixtures. They do not re-run backend persistence or recovery tests.

## Exact JSON shapes

The following TypeScript notation documents frozen serde names, not a second production authority. `UInt` means a JSON nonnegative integer from a Rust `u64` or `usize`; an adapter must preserve exact integers rather than truncate an unsafe value. `ProjectId` and the distinct `SprintId` serialize as opaque strings, not necessarily UUIDs: the source accepts 1–64 ASCII alphanumeric, `-`, or `_` bytes. The actual Sprint ID in the fixture is `a`.

Input `Option` fields may be omitted or null. Serialized Option fields below are null when absent, except `OperationReceipt.canonical_request`, which has an existing skip-if-empty attribute. Sprint execution populates that field; both captured receipts contain it. Request fields covered by `deny_unknown_fields` are the Sprint definition, command/action, list/inspect request, and board filter. Existing `ScopeBinding` is reused unchanged.

```ts
type UInt = number
type ProjectId = string
type SprintId = string
type WorkId = string
type WorkState = "draft" | "ready" | "active" | "submitted" | "accepted" | "blocked" | "cancelled"
type SprintStatus = "planned" | "active" | "closed"

interface ScopeBinding {
  scope_id: string
  supervisor_session_id: string
  binding_revision: UInt
}

interface SprintDefinition {
  name: string
  goal: string
  starts_at: number | null // Unix seconds (Rust i64); planning metadata
  ends_at: number | null   // Unix seconds, not an ISO string or runtime trigger
}

interface SprintCounts {
  total: UInt
  accepted: UInt
  pending_acceptance: UInt
  blocked: UInt
  cancelled: UInt
  unfinished: UInt
}

interface SprintWorkVersion {
  record_revision: UInt
  contract_revision: UInt
  generation: UInt
  state: WorkState
  blocked_resume_state: WorkState | null
  paused: boolean
  archived: boolean
  current_submission: string | null
  accepted_submission: string | null
  active_assignment: string | null
  context_hash: string | null
  accepted: boolean
}

type SprintMembershipChange =
  | { kind: "added" }
  | { kind: "removed" }
  | { kind: "carried_in"; from: SprintId }
  | { kind: "carried_out"; to: SprintId | null }

interface SprintMembershipEvent {
  work_id: WorkId
  work_revision: UInt
  seq: UInt
  operation_id: string
  principal: string
  source: string
  change: SprintMembershipChange
}

// Command input. Exactly unfinished members must receive one destination.
type SprintDestination =
  | { destination: "backlog" }
  | { destination: "sprint"; sprint_id: SprintId }

// Returned immutable result. Its tag is deliberately different from input.
type SprintCloseDisposition =
  | { disposition: "accepted" }
  | { disposition: "cancelled" }
  | { disposition: "backlog" }
  | { disposition: "sprint"; sprint_id: SprintId }

interface SprintClosedMember {
  version: SprintWorkVersion
  disposition: SprintCloseDisposition
}

interface SprintClosure {
  source_commit: string
  source_seq: UInt
  closed_seq: UInt
  members: Record<WorkId, SprintClosedMember>
  counts: SprintCounts
}

interface Sprint {
  id: SprintId
  project_id: ProjectId
  definition: SprintDefinition
  status: SprintStatus
  revision: UInt
  created_seq: UInt
  updated_seq: UInt
  members: WorkId[] // BTreeSet on producer; frozen closing members after close
  history: SprintMembershipEvent[]
  closure: SprintClosure | null
}

interface SprintSummary {
  id: SprintId
  project_id: ProjectId
  definition: SprintDefinition
  status: SprintStatus
  revision: UInt
  created_seq: UInt
  updated_seq: UInt
  member_count: UInt
  closure_counts: SprintCounts | null
}

interface SprintView {
  sprint: Sprint
  current_members: Record<WorkId, SprintWorkVersion>
  current_counts: SprintCounts
}

interface SnapshotRef { commit: string; seq: UInt; authority_epoch: UInt }
interface ReadCursor { commit: string; query_hash: string; offset: UInt }
interface ReadEnvelope<T> {
  snapshot: SnapshotRef
  index_seq: UInt
  coverage: string // these producer reads emit "authoritative_scope"
  truncated: boolean
  omitted_count: UInt
  next_cursor: ReadCursor | null
  data: T
}

interface SprintListRequest {
  project_id: ProjectId
  status?: SprintStatus | null
  limit: UInt // 1..100
  cursor?: ReadCursor | null
  fixed_commit?: string | null
}

interface SprintInspectRequest {
  project_id: ProjectId
  sprint_id: SprintId
  fixed_commit?: string | null
}

type SprintAction =
  | { op: "create"; definition: SprintDefinition }
  | { op: "edit"; expected_revision: UInt; definition: SprintDefinition }
  | { op: "start"; expected_revision: UInt }
  | { op: "add"; expected_revision: UInt; work_id: WorkId }
  | { op: "remove"; expected_revision: UInt; work_id: WorkId }
  | {
      op: "close"
      expected_revision: UInt
      dispositions: Record<WorkId, SprintDestination>
      target_revisions: Record<SprintId, UInt>
    }

interface SprintCommand {
  operation_id: string
  binding: ScopeBinding
  expected_seq: UInt
  expected_epoch: UInt
  project_id: ProjectId
  sprint_id: SprintId
  source: string
  action: SprintAction
}

interface OperationReceipt {
  operation_id: string
  principal: string
  request_hash: string
  canonical_request?: string // present for all commands executed by this Sprint port
  committed_seq: UInt
  ids: Record<string, string> // producer inserts { sprint: command.sprint_id }
}

interface SprintReceipt {
  operation: OperationReceipt
  closure: SprintClosure | null
}

type SprintBoardFilter =
  | { kind: "backlog" }
  | { kind: "sprint"; sprint_id: SprintId }

interface ProjectBoardRequest {
  project_id: ProjectId
  include_cancelled?: boolean // defaults false
  include_archived?: boolean // defaults false
  sprint_filter?: SprintBoardFilter | null
  limit: UInt
  cursor?: ReadCursor | null
  fixed_commit?: string | null
}
```

POST `/api/v1/tickets/sprints/list` returns `ReadEnvelope<SprintSummary[]>`; `/sprints/inspect` returns `ReadEnvelope<SprintView>`; `/sprints/command` returns `SprintReceipt`. The existing `/project-board` response remains unchanged. Do not create a separate board projection or copy Work priority, deadline, canonical state, or execution authority into Sprint membership data.

## CAS, retry, and lifecycle

- All three routes inherit access checks and require verified owner access, including reads. A run-scoped Worker credential cannot become User authority. Every route obtains and revalidates the existing canonical Supervisor binding. Body `source` or `principal` text cannot grant access.
- Reads require the host Project to exist. A new command also requires an active host Project and an existing scope-local Project Ticket link. An empty unregistered Project cannot silently create Work or a link. Archived Projects permit reads and exact committed retries.
- New commands atomically check `binding`, whole-scope `expected_seq/expected_epoch`, and the relevant Sprint revisions. `create` starts planned at revision 1. Each successful edit/start/add/remove/close increments Sprint revision. The same `committed_seq` can update multiple affected Sprints on carry-over.
- Keep the original complete command for an exact retry, including its old CAS basis and source. Receipts share the operation ID namespace with Work/file/migration commands. A changed payload under the same operation ID returns 409. The receipt contains SHA-256 of recursively sorted canonical JSON `["sprint", command]`; absent nullable definition dates normalize to null. The create capture demonstrates that raw input bytes are not the canonical request.
- A successful exact retry returns the original receipt and closing result even after later Project metadata changes. It still requires current access/binding and the mutation feature. Disabling `features.ticket_mutation` leaves reads available and rejects commands including retries with 503. Do not treat a lost ACK as failure or blindly create a replacement operation. The original command may be replayed exactly; a 409 requires draft preservation and user review. If an unpublished operation is confirmed absent after restart, obtain a fresh CAS basis before retrying it.
- `edit`, `add`, and `remove` require an open Sprint. `start` requires planned status, with at most one active Sprint per Project. A Work can belong to at most one planned/active Sprint. Adding archived Work is invalid. Close requires active status; closed Sprints are immutable.
- Close input dispositions must exactly cover unfinished Work, including active, submitted, and blocked members. Accepted-evidence and cancelled members must not be supplied in this input; the service classifies those terminal results. Each unfinished Work chooses backlog or an open same-Project target Sprint. `target_revisions` must exactly cover the distinct destinations, and the closing Sprint cannot be its own target. Carry-over is atomic with outgoing/incoming history, closure, and receipt.
- A command ACK is a committed planning result. It does not prove runtime stop, Work completion, User acceptance, claims, budget reset, scheduling, or provider execution. A running Work keeps its original Assignment/generation and may submit after carry-over. The frontend must refresh authoritative facts rather than set Work to Done on close.

Malformed JSON/unknown Sprint request fields return 400; cross-Project scope denial is 403; stale CAS or changed retry is 409; missing/mismatched fixed history or query cursor is 410 `resync_required`; absent Sprint, bad limits/lifecycle, or budget violations are 422; unavailable authority or mutation rollback is 503. Authentication may also be enforced before the handler. Preserve existing frontend error handling; a 404/405 old producer must leave Sprint controls unsupported while the original unfiltered board remains usable.

## Current observations, frozen closure, and filters

`current_members/current_counts` are observations at `envelope.snapshot`, including a fixed historical snapshot when requested. `sprint.closure` is the immutable close observation of the prior `source_commit/source_seq` with `closed_seq` recording publication. `SprintSummary.closure_counts` is that frozen count, not a current metric. Display the two explicitly and retain their snapshot provenance. Do not fill missing current facts from a closure, or derive frozen facts by recounting current rows.

`accepted` requires current, exact, non-stale accepted Submission evidence; it is not inferred from a label. `pending_acceptance` counts submitted Work. `blocked` counts the blocked state as an overlay. `unfinished` includes every nonaccepted, noncancelled member, so submitted and blocked Work also count as unfinished. These categories are not a disjoint partition to add together. `active_assignment=null` in a member version does not prove the process has stopped; no process-stopped or heartbeat field exists here.

At close, `sprint.members` retains its closing set even when an unfinished Work moves to backlog or another Sprint. History records `carried_out` with `to:null` for backlog, or a target ID. Later Work transitions, archive, or acceptance do not rewrite the immutable closure. The captured closed Sprint retains its one draft Work and its added/carried-out events; the capture's current and closing counts happen to agree. Later divergence is verified here by source review only, not by another invented response.

For the existing Project board, omitted or null `sprint_filter` preserves the old query hash and response. `{"kind":"backlog"}` excludes membership in every planned/active Sprint at the read snapshot; closed membership does not exclude a Work from backlog. `{"kind":"sprint","sprint_id":"a"}` selects that Sprint's membership at the same snapshot, retaining closed historical member IDs while displaying current Work facts from that snapshot.

Filter selection, Project, `include_cancelled`, and `include_archived` are bound into the board cursor hash. The Sprint-list hash binds Project and status; page size may change. Clear pagination when these selectors change. Continue pages using the returned cursor/fixed commit, and keep counts from the entire filtered fixed snapshot rather than counting loaded rows. Changing a query with an old cursor returns 410. A Work membership edit between pages cannot change the already-fixed snapshot. `include_cancelled=false` hides cancelled rows without removing their counts; `include_archived` determines counting scope.

Bounds are 128 Sprint members, 2048 membership events, nonblank name up to 256 UTF-8 bytes, nonblank goal up to 4096 bytes, nonblank source up to 512 bytes, and operation ID nonempty up to 256 bytes. Canonical command bytes must fit 256 KiB. If both Unix dates are supplied, end must not precede start. These are producer limits, not automatic start/stop or rollover policy.

## Source map and verification

The manifest hashes these reviewed files at the frozen commit:

- `crates/infra/bamboo-tickets/src/sprint.rs`: DTOs, version/count projections, lifecycle, CAS, receipt handling, and closing observations.
- `crates/infra/bamboo-tickets/src/sprint_query.rs`: list summaries, fixed pagination, board filter, and compatibility hash.
- `crates/infra/bamboo-tickets/src/model.rs`, `query.rs`, `lib.rs`, `project.rs`: existing ScopeBinding, WorkState, OperationReceipt, envelopes/cursors, canonical hash, errors, and Project board request.
- `crates/core/bamboo-domain/src/project.rs`: opaque ID validation.
- `crates/app/bamboo-server/src/handlers/agent/tickets/sprints.rs` and `app_state/ticket_application/sprints.rs`: actual owner routes, host Project check, archived exact retry, and mutation rollback.
- `crates/app/bamboo-server/tests/sprint_planning_http.rs`: the three completed actual router tests and original emitted request/response capture.
- `docs/guides/TICKET_SPRINT_HTTP.md` and `TICKET_SPRINTS.md`: frozen backend contract and foundation boundaries.

Run frontend fixture checks with `npm run test:run -- src/services/tickets/sprintContract.test.ts`. This test file imports only Vitest/Node utilities and fixture bytes; it does not depend on the production client or claim to prove browser, TCP, storage-restart, or Session behavior.
