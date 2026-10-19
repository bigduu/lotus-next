# Session execution compatibility v1 — Lotus consumer

This is the first frontend slice of [Bamboo #2077](https://github.com/bigduu/Bamboo-agent/issues/2077), under [#1048](https://github.com/bigduu/Bamboo-agent/issues/1048). It is a separate local branch from frozen Lotus `9ba641cf`; the accepted #2072 artifact and independent image commit `bce21edb` remain unchanged.

The latest user direction governs compatibility: compatible old sessions may open and continue. A missing version is legacy pending assessment, never an unsupported decision by Lotus. Only a canonical explicit conflict blocks affected execution. History and user files remain preserved; there is no automatic upgrade, reset or deletion.

## Frozen contract consumed

The Bamboo owner contract `2077-session-compatibility-contract-v1.json` has SHA256 `3bc014cf9371a71a61d8f893260cc2b7146b112e1c1bb736b28758e9315609f8`.

`GET /api/v1/sessions/{id}` supplies detail-only `session.execution_compatibility`: `session_version:null|u32`, `current_session_version:u32` (currently 1), `status:compatible|legacy_compatible|conflict`, `history_readable:true`, `execution_allowed:boolean`, and `conflicts:[{code,message}]`. List rows may omit the report. Title versions, Actor schemas and Root mode revisions are not behavior versions. Lotus displays version numbers without comparing them to invent a support set.

An execution refusal is HTTP 409 with `error.code=session_execution_incompatible`, the exact `session_id` and `compatibility` report. Lotus associates the report only with that requested session, shows the precise reason and original escaped diagnostic, and does not replay. Ordinary permission, network and other 409 failures stay distinct.

## Implementation

`useSessionExecutionCompatibility` reads the selected or bound session detail and exposes a nonblocking legacy/compatible/unassessed state. The small shared cache holds only memory observations; it creates no session persistence, runtime state, permissions or migration policy. Session-index refreshes cannot erase detail-only evidence. A typed refusal invalidates older in-flight detail reads; a fresh later compatible report can recover the view. Read failure, absent report and malformed report do not create a conflict, and they do not erase one already confirmed.

The notice stays above the readable transcript. The composer retains its editable draft and attachments while explicit conflict disables keyboard/button submission and edit/regenerate execution. Copy/history access, ordinary metadata actions and Stop remain available. Known conflict is checked again before ordinary send, destructive rerun preparation, detached execution, Goal execution, question/permission continuation, queued guidance and Human ingress activation. The existing backend remains authoritative for every admission and race; these UI checks do not grant execution.

A typed refusal before a new queued message's admission removes only its newly created local recovery receipt. A receipt from an earlier uncertain delivery remains intact. An acknowledged message followed by a refused execution remains acknowledged and readable; it is not reported as an uncertain upload and is not automatically retried.

No tool alias, SubAgent/Root relationship, workspace choice, Work capability or Workflow authoring path is changed. Version 1 records Bamboo's existing tool contract. Independent Root `spawn_session` and bounded SubAgent sharing the parent worktree belong to a later complete tool contract; this slice does not claim those semantics already exist. Completed legacy spawn calls alone are not conflicts.

The summary/progress/artifact-reference continuation interface is not frozen or implemented here. Existing history-cloning fork is not repurposed as summary-only continuation. A future deliberate continuation must reselect a workspace and must not copy runtime state, locks/leases, tool-call IDs, grants or credentials. Paused #2062 and #2033 remain paused; no backend ownership drain, writer reopen, Workflow authoring or workspace-admission repair is performed.

## Verification and limits

The initial new behavior selection was RED 3P/1F: missing/compatible reports could send, while explicit conflict still submitted. It became GREEN 4P, then added cases covered typed submission/execute refusal and explicit recovery.

The affected-file batch initially recorded 313P/5F. Four failures counted the new detail compatibility observation as a liveness status poll; their fixture now explicitly verifies and separates that initial observation, preserving all owned-run assertions. The fifth exposed the new queued-refusal receipt bug described above. The two repaired files passed 135 tests. A final cached Goal-callback selection passed 3 tests. Report/parser/concurrency and notice tests pass separately. Full commands, source identities and per-batch counts are retained in the local delivery receipt; aggregation is not represented as a single test invocation.

Type-check, lint, matching locale keys and architecture checks are required for the local candidate. The original #2072 83/22 suite, older native batches and frozen artifacts are not rebuilt or relabelled as #2077 results.

The initial source-only commit `ad9095c5` left build/browser acceptance unrun. The subsequent user authorization permits one new lint/build and new built-browser fixtures without waiting for backend Cargo. Product source is unchanged from `ad9095c5`; the follow-up adds framework cases and updates this evidence boundary. The new artifact and its exact frontend source/resource hashes are recorded separately from accepted `9ba641cf` in the delivery receipt.

The built-browser fixture covers compatible, legacy-compatible, missing-report, read-error, declared-version conflict, missing-version runtime conflict, typed-submit refusal with explicit recovery, and acknowledged-message execute refusal on desktop and phone. It uses synthetic HTTP responses, not the new Bamboo implementation.

**UNRUN:** current-source Bamboo #2077 HTTP integration, actual desktop WebView acceptance, and summary-based continuation. The backend owner's latest handoff is Domain RED 2P/2F with production source not yet GREEN; image #2076 retains the sole Rust window. Unit/component/browser fixtures do not establish a compiled backend or paid-model result. This frontend slice is local only: no push, merge, release, real credentials, grants, user-session writes or installation changes.
