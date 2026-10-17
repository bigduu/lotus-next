# Controlled Project Work planning and owner controls

Local component slice for Lotus [#375](https://github.com/bigduu/lotus-next/issues/375) and [#376](https://github.com/bigduu/lotus-next/issues/376), under tracker [#374](https://github.com/bigduu/lotus-next/issues/374). Base: `6cdd5e73b66e4a5d48701926e6806c23158306ed` from Draft #373. The original board remains read-only. The parent/API owner integrates this slice in a separate small Draft.

## Delivered boundary

- `src/components/app/project-work/ProjectWorkPlanningControls.tsx`: controlled planning editor, explicit offset display/clear, fixed-snapshot overdue indication and semantic sort/filter callbacks.
- `ProjectWorkOwnerControls.tsx`: owner/capability/CAS-gated Pause, Resume, Cancel and User acceptance requests; authoritative Work state, pending request and runtime ACK are separate inputs.
- `projectWorkControls.ts`: presentation types, exact Work/CAS context checks and bounded RFC3339 deadline parsing. Offset text is preserved; comparison includes nanoseconds, independent of the browser timezone or current clock. Unknown offset `-00:00`, invalid dates and leap-second values unsupported by the editor are rejected. Missing, null and invalid deadlines remain distinct. Cancelled/Accepted Work has no active overdue warning.
- `useWorkRequestGuard.ts` / `WorkRequestFeedback.tsx`: immediate duplicate/conflicting-event guard, receipt identity checking, visible uncertain outcome and read-only reconciliation. No API client, scheduler, clock polling or durable authority is introduced.

The frozen component commit `2aa970c8` only adds component/helper/test/fixture/document files. This follow-up applies the parent and public i18n seams in a second integration commit. The board hook, API client, release files and backend code remain unchanged; the ordinary production caller supplies no controls.

## Producer boundary

The Bamboo core owner confirmed the intended metadata operation:

```ts
// Domain operation description; the final HTTP discriminator/capability is not frozen here.
{
  op: "set_planning_metadata",
  ticket_id,
  expected_record_revision,
  priority,                // low | medium | high | critical; backend default medium
  expected_completion_at  // required nullable RFC3339 with known offset; null clears
}
```

The core owner's current, not-yet-frozen wire description places this operation in `POST /api/v1/tickets/update`'s `operations`, with the existing `operation_id/binding/expected_seq/expected_epoch` envelope. This operation replaces both metadata fields, through User-only owner authorization, exact `expected_record_revision` and whole-scope sequence/epoch CAS. Supervisor/Worker/Runtime actors are rejected. It does not change contract, generation, Assignment, Submission or claims. The producer plans schema 7 over Sprint schema 6. Final capability names, real examples and server query DTOs still belong to the core/API owners.

The component uses camelCase **presentation ports**, not a second wire contract:

```ts
onSavePlanning(
  { priority, expectedCompletionAt },
  { operationId, workId, generation, recordRevision,
    binding, expectedSeq, expectedEpoch }
): Promise<{ operationId: string }>
```

The parent maps `expectedCompletionAt` to `expected_completion_at`, `workId` to `ticket_id`, and the original row's `recordRevision` to `expected_record_revision`; identity and scope CAS go into the existing envelope. Never silently refresh/rewrite that revision to overwrite a conflict; preserve the controlled draft on 409. A callback receipt confirms delivery only. The parent's canonical read/event projection supplies saved planning, Work state, request phase and runtime confirmation. No receipt callback changes them locally.

Until a producer capability is confirmed, use `current: null`, `editCapability: { available: false }`, `queryCapability: { available: false }` and unavailable owner capabilities. Missing fields on an older backend must not silently become frontend-owned default values.

## Parent integration contract

1. Derive `owner` from existing verified owner access, and capabilities from the producer's allowed operations. Selected chat/project/Work does not grant authority. Commands require a real ScopeBinding, whole-scope expected sequence/epoch and matching Work generation/record revision.
2. Supply a stable operation identity for each exact payload/context. The immediate guard latches it after one delivery, including transport errors. Restore pending/unknown facts from the backend on reload; do not clear uncertainty or allocate a new operation merely because a request timed out. `onReconcile(operationId)` reads/reconciles the same identity and must not blindly resubmit a command.
3. On conflict/denial/failure, expose the request feedback and perform an explicit canonical reload. Supply a fresh command context only after the old request's outcome is resolved and the next action is authorized. Key mounted controls by Work ID/generation as shown in the handoff patch.
4. `onQueryChange` receives UI semantic tokens (`updated`, `priority`, `expected_completion`; priority filter; `any`, `overdue`, `unset`; fixed `asOf`). Translate only after the server DTO is frozen. Reset cursor/fixed-snapshot state for a changed query; retain one explicit `as_of` across its pages. Whole-snapshot deterministic ordering, tie rules, query-bound cursor, counts and index-gap handling remain in the parent/server. No partial page is sorted here.
5. For User acceptance, `acceptance` must reference the exact current submission/generation/contract. Require explicit backend stop-guard support and `processStopped === true`; absent `active_assignment` is insufficient. `acceptanceConfirmation` is bound to submission ID/generation/contract, and its callback returns that exact identity or null. A prior checkbox confirmation cannot authorize another submission. The intent carries `source: "user"` and the visible unverified items. Backend Accept/evidence/stale/unknown-effect checks remain mandatory.
6. The parent preserves evidence/unverified items after acceptance and sets `acceptedByUser` only from the canonical acceptance source. A User decision never generates an automated-test pass. Runtime ACK can coexist with unchanged Active Work; only authoritative props can show Paused/Cancelled/Accepted.

Current producer gap: existing Accept does not yet enforce `Assignment.process_stopped`, and Submit may clear `active_assignment` while a process still awaits stop confirmation. Manual acceptance must remain unavailable until the separate backend/runtime slice closes that gap. Pause/Resume/Cancel/query controls also remain unavailable without their corresponding frozen capabilities.

## Parent integration and retained handoff patches

- `patches/planning-controls-i18n.patch`: 71 paired English/Chinese keys plus a copy mapper; public catalogs are not edited by this slice.
- `patches/planning-controls-parent.patch`: optional controlled props and matching-selected-Work slots in the parent board. Defaults show no controls. It deliberately adds no HTTP adapter or fabricated capabilities.
- `patches/planning-controls.zh-CN.json`: reviewable Chinese copy mapping; English copy is in `e2e/fixtures/project-work-controls-copy.json`.

Both patches passed `git apply --check` on the stated base and are retained as the original component handoff. This follow-up applies them and hardens the slots: Work ID, generation, record revision and actual state must match the canonical selected row; owner controls also match the contract/current submission. Commands outside the row scope or page sequence/authority epoch are removed. Stale controls cannot submit, and the externally controlled draft is retained. Verified owner access also gates mounting. `ProjectWorkDialog` forwards the optional controls without enabling them in its ordinary production caller.

Eleven parent integration cases pass alongside the original board and 38 component cases (59 relevant tests). Two new Chinese 1440px/390px browser host cases exercise these real parent slots with explicit mock HTTP and synthetic callback receipts. They do not establish a production producer adapter or safe runtime controls. Save/query/owner capabilities remain unavailable until the corresponding producer DTO and capability have actually been verified.

## Verification scope

The component tests cover offset/day boundaries, null/invalid/unknown dates, nanosecond `as_of`, owner/capability/CAS gates, duplicate/conflicting events, lost/mismatched receipts, pending reload, old Work replies, runtime ACK without actual state change, exact User acceptance and unverified evidence.

`playwright.planning-controls.config.ts` runs an isolated loopback Vite fixture with synthetic view models and callbacks. It captures 1280px and 390px light/dark screenshots and checks keyboard/touch actions, query/CAS payloads, null clearing, pending ACK and conflict reload. This is **component fixture evidence**, not a live Bamboo HTTP/runtime/storage/provider end-to-end test. The fixture is not a production route and is excluded from the production build entry.

Screenshot files are under `assets/planning-controls/`. Raw check receipts and original failed attempts are retained in the task's sibling `evidence/` directory. Earlier attempts preserve a default-sandbox loopback EPERM, browser-fixture page-height correction, Node-only browser-test typing corrections, fixture fast-refresh lint correction, default npm-cache EPERM and a 130-byte startup-CSS budget overrun. Existing focus/width/grid utilities replace the added CSS selectors; budgets are unchanged. Packaging uses the task's own npm cache without changing global permissions. Final counts are recorded in the handoff receipt after checks complete.

Final checks on the frozen component source (Mac, Node 26.11.1):

- `npm run verify` with task-scoped `npm_config_cache`: passed, 173 files / 3457 unit tests; type-check, lint, i18n, architecture, build and package-content/bundle-budget checks passed. The validated source-file hashes remained unchanged throughout.
- New focused component/deadline contract suite: 38 tests passed; these are included in the full count.
- `playwright test --config=playwright.planning-controls.config.ts`: 6 passed, no skips/retries, synthetic callbacks only. Four final screenshots were visually inspected.
- Both unapplied handoff patches passed `git apply --check`; final staged source passed `git diff --check`. Shared parent/API/i18n/release files are byte-identical to the base.

These results do not establish production adapter integration, real owner authorization/CAS behavior, durable runtime ACK, provider execution or safe manual completion. Those remain separate backend/integration gates.

Producer update received after component freeze: Bamboo #2054 reports a planning Draft at `268bb40dc2819b573d2202ae9158ec9497ae54ca`; its real HTTP test is not yet compiled. A separate proposed optional inspector `controls.accept_requires_stopped_assignment` is not consumed here. A future adapter may set `stopGuardEnforced=true` only for explicit implemented support, and `processStopped` only after an exact current Submission → Assignment/generation/contract join. Missing controls or an incomplete join stay unsupported/null. No Draft or service-test result alone enables manual acceptance.
