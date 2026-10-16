# Supervisor Work availability (#322)

Parent tracker: [Bamboo #1968](https://github.com/bigduu/Bamboo-agent/issues/1968).
This frontend slice reuses #318's Supervisor entry and the #231/#235 Workbench;
Project section persistence remains owned by #319.

## Confirmed frontend defect and legacy API

At Lotus `1dc7bfe`, ChatPane shows `Work is unavailable for this Supervisor.`
whenever negotiated Ticket data has no binding matching the current session.
The client collapses 404, available=false, missing binding/overview, missing
required capabilities, and another session's binding to null. Transport errors
remain in useTicketWork but disappear behind the fallback. This patch preserves
the reason and exposes a check-again action. Zero Work in a valid complete scope
is a ready empty snapshot, never an access denial.

`GET /api/v1/tickets/scope` in the inspected legacy producer returns:

- Success: available=true, binding (scope_id, supervisor_session_id,
  binding_revision), health, mutation_enabled, dispatch_enabled, capabilities,
  and a snapshot-pinned overview.
- Unavailable: available=false and reason; mutation/dispatch flags are returned
  on the authority-failure branch. Other fields can be absent.
- Unauthenticated owner access: HTTP 401/403. Route absence: HTTP 404.
- Transport/timeout/service/malformed response: error; it is not empty Work.

The required capabilities remain ticket_scope_v1, multi_pending_v1, and
precise_request_response_v1. Decision and semantic ingress authority still use
the exact binding, writable health, feature flags, completeness and existing
capability checks. A failed read stops mutations. A transient failure keeps
previously visible records marked disconnected; denied access or withdrawn scope
clears them. No new authorization derives from session titles or Ultra.

## Existing initialization boundary

Bamboo dev `48e1283f` opens TicketApplication once at startup. It creates a new
empty scope only when ticket_mutation is enabled and the canonical Supervisor
is freshly created by that startup. An already existing Supervisor without its
Ticket HEAD returns the exact reason:

`authority_unavailable: existing Supervisor needs explicit attach/import; no automatic takeover`

The default Supervisor entry can create the identity separately later. Neither
that entry nor an Ultra mode switch reopens the TicketApplication. This is a
source-confirmed candidate for the screenshot, not a diagnosis of its actual
service configuration or HTTP response, which has not been captured.

For the current legacy response format, only the two exact source-verified
reasons (disabled mutation; explicit attach/import required) receive special
presentation states. Other available=false reasons remain errors with their
reported detail. Unknown data is never guessed to mean disabled or forbidden.
HTTP 404 and missing mandatory capabilities are explicitly unsupported. A
binding for another session is unbound. Valid scopes with flags rolled back
remain readable and visibly disabled for the affected operations.

## Frozen v1 usable path (Bamboo #1971)

The producer owner froze v1 before this implementation. The explicit endpoint is accepted against an isolated producer candidate below;
merging and deployment remain separate. Browser fixtures alone do not prove live availability.

GET `/api/v1/tickets/scope` retains all legacy fields and adds:

- `availability: {kind, reason_code}`, with kind ready, uninitialized, disabled,
  forbidden or error.
- `readable`, equal to available. Valid zero Work is ready/readable. Existing
  valid data stays ready/readable when mutation or dispatch is disabled.
- `can_initialize` and `initialization`, null or the exact confirmation
  `{supervisor_session_id, incarnation_id, binding_revision}`.
- `capabilities.scope_initialize_v1` to advertise the explicit setup endpoint.

| Reason code | User guidance |
| --- | --- |
| scope_ready | Display the canonical Work snapshot, including a valid empty scope. |
| scope_uninitialized | Offer empty initialization only when capability, permission and confirmation are all valid; otherwise explain missing eligibility. |
| ticket_mutation_disabled | Ask the operator to review configuration; keep readable records when present. |
| supervisor_mode_required | Use the existing mode menu to explicitly select Ultra, then re-read. |
| supervisor_identity_mismatch | Open the fixed Supervisor entry and re-read; no authority derives from the title or Ultra. |
| scope_binding_mismatch | Review the old binding through the offline recovery procedure; do not rebind automatically. |
| scope_requires_recovery | Review occupied/incomplete storage and use the explicit offline recovery/attach/import procedure. |
| scope_io_error | Check storage access and integrity, then re-read. |

The button requires verified owner access, a current read, an unblocked mode
transition, `scope_initialize_v1=true`, `can_initialize=true`, a UUID confirmation
for this session, a positive safe binding revision, uninitialized status and an
enabled mutation gate. Contradictory or incomplete v1 responses remain visible
errors and cannot fall back to legacy reason parsing. Old services keep only
status guidance and the check-again action.

On a user click, POST `/api/v1/tickets/initialize` sends only the three confirmed
fields through postOnce. It sends no mode, feature/configuration, path, history
source or caller-generated operation ID. The service rejects unknown fields and
revalidates its canonical identity, incarnation and revision. A shared in-memory
request lock prevents duplicate initialization from either pane; it shares no
scope data or permissions. Poll/focus/online reads wait while this write is in
flight.

A 200 needs boolean `created` and a complete readable v1 scope bound to the exact
Supervisor/incarnation/revision. Both created=true and idempotent created=false
are accepted. The panel still waits for a full canonical GET/search read before
showing ready. A failed/mismatched canonical read remains unconfirmed.

A 409 reports `initialization_conflict`, `scope_requires_recovery` or
`scope_binding_mismatch` plus an owner-only scope. The client preserves the stable
reason and re-reads canonical state; a readable conflict can restore the read
view while respecting the current mutation/dispatch flags. The returned scope is not treated as
a complete set of Work records. No POST is replayed. 401/403 withdraw the offer;
503 uses the documented stable reason code and a fresh read. Transport failure,
unknown/malformed acknowledgement or unsupported refusal stays visibly
unconfirmed and also gets a canonical read, never an automatic write retry.

Navigation, owner access and mode lifecycle changes invalidate the captured
read/command context. A pending Root mode fence blocks initialization and
Work writes, while scope reads remain available to report their own independent
status or error. Only the first identity-metadata read defers initial scope
negotiation. Later unchanged metadata refreshes keep the established context;
loading/confirmation UI flags are not durable authority revisions. Late receipts cannot update the newly selected context.
The mode birth token and transition epoch are local read fences only;
binding_revision always comes verbatim from the service confirmation. Standard
mode and an old binding stay separate recovery states. Initialization never
switches mode, changes gates, resets a store, imports history, or associates
historical sessions.

## Validation boundary

Unit regressions cover the legacy HTTP shape/exact backend reasons and the
frozen v1 status, confirmation and refusal contract.
The built-browser suite fixes the trusted Supervisor entry, Ultra mode and Work
side panel, and covers each availability state, zero Work, check-again recovery,
read-only flags, preserved draft and Ultra exit/re-entry without scope setup.
These are deterministic HTTP fixtures, not the user's actual server or real
model semantics. No paid model invocation, Rust compile, publication, push,
merge or persistent permission expansion is part of this slice.


Earlier availability checkpoint (61d740b): 144 unit files / 3,043
tests; 54 built-browser cases (Work availability, workbench, Supervisor entry,
and owner access); the final availability/screenshot rerun passed all 24 cases.
Type-check, lint, i18n (2,078 keys), architecture, production build and package
contents passed. Startup CSS stays inside the unchanged 109,000-byte gate
(108,993 bytes); no budget was raised.

Deterministic fixture screenshots: [uninitialized desktop](screenshots/supervisor-work-availability/uninitialized-desktop.png),
[ready empty desktop](screenshots/supervisor-work-availability/empty-desktop.png),
[service error desktop](screenshots/supervisor-work-availability/error-desktop.png),
[disabled phone](screenshots/supervisor-work-availability/disabled-phone.png).
The empty recovery fixture models a changed canonical service response; it does
not demonstrate the pending online initialization API.


Earlier initialization-client checkpoint (aa32c7a): all 3,057 unit tests passed
(144 files), including 14 added exact-command/receipt/refusal cases. The existing
Work availability and owner-access built-browser regressions passed 33 cases on
the new bundle. Type-check, lint, i18n (2,079 keys), architecture, build and
package gates passed; no budget changed. These checks do not claim that an
initialization button or the producer's live endpoint has been accepted.

Frozen v1 supersedes the earlier pending wire decisions. The isolated live
round trip below closes the frontend setup contract gap. The screenshot's actual
backend branch and configuration remain unverified.


Final v1 frontend validation: 144 unit files / 3,100 tests passed; 90 built-browser
cases passed across desktop/tablet/phone (60 Work availability/initialization,
3 Workbench, 18 Supervisor sidebar, 9 owner-access cases). The owner-access suite
retains its strict zero unexpected network failures/errors assertion. A caught
ordinary-metadata-refresh cancellation regression was fixed by using stable
birth/epoch/mode data for the Work read context, rather than loading/confirmed
UI flags. Unchanged metadata refreshes do not withdraw readable Work.

Type-check, lint, i18n (2,094 matching keys), architecture, production build and
package contents passed. Initial CSS remains 108,993 bytes under the unchanged
109,000-byte gate. No real model, Rust compilation, push, merge or publication
was performed by this frontend slice.

Frozen-v1 HTTP fixture screenshots: [explicit empty initialization](screenshots/supervisor-work-availability/initialize-desktop.png),
[phone action](screenshots/supervisor-work-availability/initialize-phone.png),
[canonical ready after initialization](screenshots/supervisor-work-availability/initialized-empty-desktop.png),
[old binding after mode changes](screenshots/supervisor-work-availability/old-binding-desktop.png).
They exercise the actual frontend POST and canonical re-read against deterministic
responses. They are not a live #1971 round trip or proof of the screenshot's
actual service configuration; the unrelated permission picker in the fixture
retains its own unsupported-capability message.


## Actual isolated HTTP/UI acceptance

The final code candidate is Lotus `3f808b957e24772e0ced6b32c05c4f2674291db1`,
with a clean source manifest and resources SHA-256
`f9aabfc788f9cc101583115cdc63506d4645d5d2d37af2977805ab7fc6ecab36`.
It was exercised against prebuilt Bamboo
`56611128e09bc92fb8368c6d77badad2bbed60ca`, binary SHA-256
`e9f0af44236ca766226be686843c2c742a82ecd1f62197c209cd4e983defa17b`.
The frontend did not compile or modify Bamboo. Later producer `3a241bc2` has
not been exercised by this frontend acceptance.

The producer-owner handoff instance first confirmed the frozen v1 response and
explicit UI initialization. A separate disposable instance of the same binary
then verified the final frontend and mode changes without changing either
handoff instance. It had no provider credentials or configured model; Dream and
dispatch were disabled. Its test feature flags were fixed before launch, and
remained mutation=true / dispatch=false across initialization. The normal
setup-complete UI action affected only that disposable data directory.

| Actual service/UI check | Observed result |
| --- | --- |
| Eligible fresh scope | uninitialized, marker=true, can_initialize=true, exact three-field confirmation |
| Explicit UI initialization | HTTP 200, created=true; canonical ready/readable, zero Work |
| Explicit duplicate confirmation | HTTP 200, created=false |
| Stale revision UI request | HTTP 409, scope_binding_mismatch, fresh readable scope; canonical read restores the empty view |
| Canonical refresh and reload | Ready empty remains readable; no second automatic POST |
| Explicit Standard selection | Mode-required reason; previous Work and initialization action withdraw |
| Explicit Ultra re-entry | Old binding rejected; no automatic rebind, import or initialization |

To reproducibly obtain the readable 409, one page's initialization request was
queued while a second real page initialized the store. The test changed only
the known revision field of the queued request on the wire. The frontend's
original submitted confirmation stayed exact, and all responses came from the
actual service. This is deliberate request fault injection, not an observed
natural race or a fabricated HTTP response.

That round trip exposed a misleading frontend warning: a known 409 followed by
a fully readable canonical scope still advised offline binding recovery.
`3f808b9` now retains the refusal as a conflict while showing the current scope.
Unreadable stale bindings retain offline recovery guidance. Unknown outcomes
remain unconfirmed; no write is retried automatically.

After the correction, full verification passed 144 files / 3,100 unit tests,
93 built-browser cases, type-check, lint, 2,094 matching i18n keys, architecture,
build and package checks. CSS remains 108,993 bytes under the unchanged budget.
The live run passed with zero page errors. No v1 field change was needed.

Machine-readable evidence summary: [live contract receipt](evidence/supervisor-work-live-contract.json).
Actual service screenshots: [initialization offer](screenshots/supervisor-work-availability/live-initialize-desktop.png),
[ready empty](screenshots/supervisor-work-availability/live-ready-empty-desktop.png),
[readable 409 recovery](screenshots/supervisor-work-availability/live-readable-conflict-desktop.png),
[old binding after mode changes](screenshots/supervisor-work-availability/live-old-binding-desktop.png).

This validates the usable empty-scope setup and read path. It does not establish
the original screenshot's configuration, live model-tool execution, dispatch,
or the producer's later broker activation change. Producer review/merge and
deployment remain separate dependencies. All frontend changes are local commits.


## Current-main local integration (2026-10-16)

The integration starts from Lotus main
`5c4f713f2b8624f881c6739ae28d7091f48f796e` and retains the original
`4c0d898230aac26158d4c37c5a8fdcd83d2775ff` branch and evidence unchanged.
Merge `6c09aef9a9d88d475409a08cb47335f75cde7ba1` preserves both histories;
only the two UI locale files overlapped, and main's accepted Project and Nova
strings remain present. There is no manifest, lockfile, workflow or release-gate
change in this slice.

Product change `fb663875151c175ca077e491ddb1245f3eb1e181` now reads the already
delivered `assignments` inspection section. The panel shows the Work objective,
the exact execution session and recorded execution status, confirmed process
termination when provided, and the current/accepted result. Generated evidence,
paths and opaque submission diagnostics remain collapsed. The visible objective
is user task data, rather than a generated diagnostic. Existing refresh,
artifact read, exact answers/approvals and request references retain their gates.

An execution record must match the explicit active assignment, or the selected
non-stale result's assignment, plus Work ID, generation and contract revision.
An omitted section or a mismatched record is unconfirmed, not an empty managed
session list. These are records at a fixed snapshot, not proof that a process is
currently alive. Denied scope/access and context changes still withdraw records.

All read sections use the same `fixed_commit` and 65,536-byte limit. If a long
assignment history exceeds that limit, one read-only fallback requests the
original requests/submissions sections at the same commit. Work and exact
decisions can remain complete, while execution metadata stays unconfirmed.
A conflicting fallback snapshot is rejected. This never retries a write.

### Accepted producer contract

Source comparison uses accepted Bamboo dev
`bf6b20bab2832b45d4b0927e971cea64866f2c77`. Its initialization/state code,
Ticket model and query projections are byte-identical to the previous live
candidate `56611128`. The only production change in the Ticket HTTP handler is
the standard nested error value:
`{error:{type:"api_error",message}, code, scope}`. Confirmation fields, eligibility,
readability, operation flags, scope verification and refusal codes are retained.

The existing transport parses both legacy string and nested messages. Browser
fixtures now exercise the accepted nested form. A documented HTTP 403 with a
strictly validated forbidden scope can explain a mode/identity refusal without
claiming owner authentication failed. It still clears records and initialization
eligibility, performs no denial-triggered read, and never promotes a readable or
contradictory denial scope. Ordinary owner denials remain access denials.

The [source proof](evidence/supervisor-work-current-contract.json) is static
compatibility evidence, not a new HTTP/server run. The old actual HTTP receipt
and screenshots retain their original frontend/backend identities.

### Supervisor cross-session long-running boundary (#1976)

The execution sessions above belong to the current Work scope. They do not
enumerate all independent Roots attached to Supervisor or confer control over
them. Accepted `session_control` still advertises only `followup`; admission is
not proof of an objective update or task completion. No ordinary Root's own Loop
entry is used as Supervisor control. The panel explicitly says cross-session
long-running controls are unavailable, with no simulated start/update/stop buttons.

[Bamboo #1976](https://github.com/bigduu/Bamboo-agent/issues/1976) remains a separate
backend control slice. Before enabling a frontend control, its owner must deliver
the actual routes/tool contract, negotiated support and scoped target readback.
These are interface requirements, not invented wire fields:

- Read only explicitly managed targets and return their current objective,
  recorded state/result and permitted actions. A global session list is not a
  substitute for that authority-scoped inventory.
- Freeze start/status/update/stop requests and receipts, exact target lifetime,
  Loop revision/generation, idempotency and bounded patch semantics.
- Distinguish accepted, applied, running and terminal results, including deferred
  changes at provider-safe boundaries. A followup receipt cannot confirm a goal
  update. Keep last outcome, next wake and remaining limits truthful.
- Revalidate Supervisor identity, target lifetime, attach/Project relation and
  permissions on admission and future wakes. Denial/revocation, mode/navigation
  changes and pending human questions must not leak records or start work.
- Keep missing capability, empty inventory, paused/waiting, denied scope,
  unknown acknowledgement and service errors distinct. Never attach historical
  sessions, expand a gate or retry a control operation automatically.

Current local frontend validation and remaining actual pairing work are recorded
in the [integration receipt](evidence/supervisor-work-main-integration.json).
New real HTTP coverage must use an owner-provided binary for the accepted dev:
initialization/refusal, a nonempty execution/result scope, budget fallback,
revocation and reload. Actual cross-session Loop control remains #1976 acceptance.
No Cargo, backend process, model execution, dispatch, push or publication was run
by this integration task.


Validation: `npm run verify` passed on Node 24.21.0 at the product commit:
149 files / 3,253 unit tests and all type/lint/i18n/architecture/build/package
gates. The complete affected browser matrix passed 118 cases with 2 existing
desktop-only drag skips. The final test-only metadata calibration reran its
3 affected cases across all viewports; the other tests retain their original
matrix receipts. Product resources are identical across those test-only commits.
No historical result is relabelled as a new run. Startup JS is 1,899,985 bytes
under the unchanged 1,900,000-byte limit; CSS is 108,993 under 109,000.

Final fixture screenshots: [desktop execution/result](screenshots/supervisor-work-availability/integrated-execution-desktop.png),
[phone execution/result](screenshots/supervisor-work-availability/integrated-execution-phone.png).
These show exact scoped runtime records and existing decisions, not a real
running-model result. The fixture does not advertise the unrelated typed
permission capability; its separate unsupported-permission notice remains
visible. It is not a diagnosis of the actual backend's permission support.
