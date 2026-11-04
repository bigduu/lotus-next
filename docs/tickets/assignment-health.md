# Project Work assignment history and Session access

Follow-up for #377/#378 under #374, stacked on the controlled planning slots in #380. The original #373 remains a separate read-only MVP and keeps its recorded real-HTTP source. No release, backend state, scheduling or acceptance behavior changes here.

The four controlled panel/helper/test files originate from `1dc89957bdc2d8d64ae667aaaa9bef961c6156bf` (tree `7f968312dfcd504e8fac86f17822b581a585acfe`). The integration reuses that source and connects the public English/Chinese copy and parent board. It distinguishes the generic missing-fact label from the recovery-observation label; the original unapplied copy patch used a duplicate key for those two meanings.

## Existing facts and read boundary

The existing pinned inspector explicitly requests `assignments` with full coverage. Its array is Assignment history after a stop as well as during execution. `Work.active_assignment` selects the current reference; Work/generation/authority epoch, supported Assignment state and the RuntimeReceipt tuple must agree. Array order, names, heartbeat or selected chat never select an owner. Other roles require an explicit canonical association.

The API type now names the existing optional `work_id`, `generation`, `authority_epoch` and `process_stopped` inspector fields. Older backends may omit them; the UI keeps raw locatable refs while current ownership stays unconfirmed. `active_assignment=null` does not prove a process stopped. Only an explicit `process_stopped=true` confirms that historical stop.

## Runtime snapshot

The selected owner Work detail reads Bamboo's observation API after the board
and inspector identify the same current Assignment. The read also covers a
current pointer with an unresolved outcome and a unique stopped attempt linked
to an exact open yielded Question. Those
reads rely on the backend to verify the saved runtime evidence. The read sends only
Project, Work and Assignment IDs. The response must match those IDs, the
generation, original Assignment authority epoch and exact Ticket commit. An
unresolved or yielded attempt can retain its original epoch after the writer reopens and
advances the board snapshot's epoch. It is a one-shot,
uncached snapshot. Closing or switching details, losing owner access, or
going offline invalidates the display. The existing refresh and reconnect
paths obtain a new pinned snapshot before requesting evidence again.

Task entry, heartbeat, effective progress (including the committed sequence)
and expected wait are independently rendered. Missing facts stay unknown,
including progress when a heartbeat is available. Wait allowance is a patrol
diagnostic threshold. It does not establish the next patrol check or a business
deadline. An unresolved execution outcome is displayed only when the backend
reports it. Denied and unavailable reads retain unknown facts. Incident and
recovery history, program and model timing, and observations for historical
stopped Assignments require separate acceptance.

Going offline invalidates the current association/access display. Reconnect uses the existing board refresh and discards the old pinned details. The fixed snapshot establishes reference provenance, not live physical health.

## Saved patrol checkpoint

The selected detail reads the owner-only patrol status independently of the
runtime observation. The pinned inspector can still identify the saved
checkpoint after submission or cancellation when it proves the exact attempt.
The response must match the Ticket commit and cursor and the scope, including
the attempt's dispatch epoch. If the inspector cannot corroborate the epoch
after reconciliation, the status stays unknown.

The card distinguishes a saved checkpoint from a stale historical record,
an absent check and an unreadable checkpoint. Check times and incident phase
describe the saved checkpoint. A queued escalation indicates delivery to the
Supervisor Inbox. Execution progress and owner acceptance retain their own
evidence.

## Existing Session navigation

The parent reads the existing `GET sessions/{encoded-id}` for unique, scoped canonical Assignment/RuntimeReceipt targets, with four bounded concurrent reads and cancellation when details change. Successful matching responses permit a Session button. HTTP 403 and 404 preserve the recorded IDs with distinct denied/missing explanations; transport failures and inconsistent identity/Project metadata stay unknown.

Opening rechecks that exact Session access. An older response cannot overwrite a newer access read, and an aborted/stale read cannot navigate. The navigation port receives the access-check callback so the app records the navigation intent before awaiting that check; another selection, including returning to the same Session, supersedes the old intent. The existing app navigation then restores the already-persisted root/child Session. This path never calls Supervisor initialization, creates a Session, sends a message or starts execution. Opening a Session does not claim that its recorded historical run is currently running.

The real-HTTP fixture's `synthetic-worker` is not a proven persisted Session. The adapter and callback tests use explicitly controlled GET responses. A real persisted Session navigation round remains an integration gate; it is not claimed from the synthetic fixture.

`OpenWorkSession` returns whether navigation completed. The dialog closes only for a completed navigation; a newly denied/missing Session leaves its updated explanation visible. The six navigation-port tests cover late access, late restoration, an unchanged Session ID with a newer intent, and a deleted Session without replacement.

## Verification provenance

The original component's full verify reported 172 files / 3457 passing tests, including 38 focused panel/helper cases, and six controlled browser cases. The frozen component is reused without relabeling those results as the integrated source.

`src/test/fixtures/projectWorkAssignmentContract` retains four byte-exact active/stopped responses from the already-completed Bamboo `f7c274cd` actual-HTTP synthetic fixture, with hashes and scope metadata. These regression tests replay captured responses; they do not start or repeat that service. New access tests cover exact encoded GETs, distinct errors, inconsistent identities, deletion before click, offline invalidation and cancellation.

Three new parent browser cases use those captured board/inspect responses plus separately labelled controlled Session GET results, with no API writes or provider. Desktop/light and 390px/dark screenshots cover an active exact callback, stopped history with a missing Session, and denied access. The existing startup CSS budget remains 109000 bytes; both feature slices must pass it together.

Planning, manual completion, patrol incidents and Sprint adapters remain separately gated by their confirmed backend capabilities and evidence.
