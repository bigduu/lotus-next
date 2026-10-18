# Sprint planning on the Project Work board

The existing Project Work board consumes the additive Sprint routes in Bamboo
Draft #2052, exact `b3a60a7f51b131b1f136ccb5fd78b2317f94a925` / tree
`3bae5e25f941c82be73e63808ae3cdba269a0b72`. This frontend follow-up stays in
Draft #381 above #380. It does not change the separately frozen #373 MVP or
admit a release.

## Read and command behavior

The selector offers All Work, backlog, and discovered Sprints on the existing
board. All Work omits `sprint_filter`, preserving the old request/hash. Explicit
filters reset the board cursor and selected Work; later pages keep the original
commit, query hash, counts and membership. A failed/unsupported Sprint read
keeps All Work available. Foreign Project and incomplete reads fail closed.

Closed Sprints show retained historical membership alongside Work facts at the
requested snapshot. Current counts and immutable closure counts have separate
labels and snapshot references. Neither sequence numbers nor membership history
are presented as timestamps, heartbeat, effective progress or acceptance proof.

Owner commands support create/edit/start, adding/removing existing canonical
Work IDs, and closing an active Sprint. Every unfinished Work needs an explicit
backlog/target choice; target revisions are preserved exactly. Accepted and
cancelled members are excluded from requested dispositions. A planning receipt
does not stop execution, reset budgets, copy Work, or accept unfinished Work.

Writes require verified owner context, an active Project, a supported scope,
enabled mutations, complete authoritative scope coverage and the exact board
snapshot. Request identity, binding, scope CAS, Sprint revision and target
revisions freeze before the first attempt. There are no automatic write retries.
409 preserves the draft and requires explicit review of a fresh snapshot.
Refreshing does not unmount the editor or replace draft CAS automatically.

Unknown results retain the full original command in a tab-local request journal,
including across dialog close/reopen. Only an explicit check repeats the exact
command. A failed check, including permission denial, remains unknown. Reopening
against a different canonical scope cannot replay the old command. This journal
stores request/receipt identity, not another Sprint or Work authority.

## Evidence boundaries

The committed raw producer payload and manifest under
`src/test/fixtures/sprintContract/` are byte-exact captures from three passing
production Actix route tests. The read examples have equal current/closure
counts; frontend divergence cases are explicitly controlled variations.

The dedicated `playwright.sprints.config.ts` exercises the real parent and
adapters against controlled HTTP responses. It covers keyboard/phone selection,
unchanged snapshots/cursors, explicit close dispositions, draft preservation,
unknown-result reconciliation, unsupported routes and cross-Project denial.
It does not prove a socket-hosted #2052 producer. Its `.pw.ts` file is separate
from the unchanged default 549 built-artifact cases, and it is a required normal
CI step. Existing component browser checks retain their original 11 cases.

Producer validation subsequently completed for planning #2054 at exact `268bb40d`
(one HTTP scenario) and #2056 at exact `b11a8997` (planning and stop-guard scenarios).
Those use production routes in process and are separate source-bound evidence.
No socket/browser or new Work-write consumer acceptance is inferred from them.
Manual Work acceptance and missing priority query/heartbeat/progress capabilities
retain their existing gates in this Sprint slice.

Actual persisted Session root navigation is tested separately, when the owned
precompiled f7 fixture is ready. Its canonical root API cannot create a child or
replace the fixture's hardcoded `synthetic-worker` RuntimeReceipt. A controlled
receipt association used to exercise the consumer must be labelled hybrid;
it never proves a real Assignment-to-Session link or backend restart durability.
