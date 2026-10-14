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

The producer owner froze v1 before this implementation. The producer endpoint
is still a separate dependency; browser fixtures do not prove a live deployment.

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
view while mutation/dispatch stay disabled. The returned scope is not treated as
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

Frozen v1 supersedes the earlier pending wire decisions. The live #1971 producer
and a real owner-only round trip remain required before claiming live setup or
identifying the screenshot's actual backend branch.


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
