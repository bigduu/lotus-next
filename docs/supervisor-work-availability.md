# Supervisor Work availability (#322)

Parent tracker: [Bamboo #1968](https://github.com/bigduu/Bamboo-agent/issues/1968).
This frontend slice reuses #318's Supervisor entry and the #231/#235 Workbench;
Project section persistence remains owned by #319.

## Confirmed frontend defect and current API

At Lotus `1dc7bfe`, ChatPane shows `Work is unavailable for this Supervisor.`
whenever negotiated Ticket data has no binding matching the current session.
The client collapses 404, available=false, missing binding/overview, missing
required capabilities, and another session's binding to null. Transport errors
remain in useTicketWork but disappear behind the fallback. This patch preserves
the reason and exposes a check-again action. Zero Work in a valid complete scope
is a ready empty snapshot, never an access denial.

`GET /api/v1/tickets/scope` currently returns:

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

## Safe usable path and pending producer contract

Current routes provide no online empty-scope initialization. The HTTP update
handler rejects Import/AttachLegacy and retains the verified offline Host port.
The UI currently gives explicit offline operator guidance for the legacy
uninitialized reason and does not claim initialization succeeded.

The paired producer [Bamboo #1971](https://github.com/bigduu/Bamboo-agent/issues/1971)
now defines the initialize endpoint and three-field confirmation. The remaining
availability shape/reason codes must be fixed before a new button is wired.
The minimal usable flow is:

1. A verified owner reads a stable availability/reason code that distinguishes
   an eligible new empty scope from legacy attach/import requirements.
2. Only an explicitly eligible response exposes initialization plus the
   producer's confirmation data bound to the current Supervisor incarnation,
   mode and revision. The UI sends these exact values on a user click.
3. One initialization POST is admitted at a time. It changes neither feature
   gates nor historical session links, and cannot reset an occupied/damaged
   Ticket directory. No automatic retry of an uncertain write.
4. A matching success is followed by a complete canonical read. The panel is
   ready only after that read; a disabled operation remains visibly disabled.
5. Conflict or uncertain acknowledgement stays visible and triggers a fresh
   eligibility read. The user can act only on that newly confirmed state.
6. History requiring import stays a separate reviewed offline procedure.

The client now implements only the confirmed request/receipt boundary:
`POST /api/v1/tickets/initialize` submits supervisor_session_id, incarnation_id,
and binding_revision exactly from the future eligible GET confirmation. It
copies only those three fields and uses postOnce (no transport replay). Positive
safe-integer revisions are required. A 2xx result needs boolean created and a
valid readable scope bound to that exact Supervisor/incarnation/revision. Both
created=true and created=false are valid, but neither replaces the required
canonical re-read.

The execute button remains absent until the producer fixes the availability
wire shape and eligibility/reason codes. Required distinctions include current
Standard mode, stale persisted binding, and nonempty/incomplete storage requiring
offline recovery. These are producer dependencies under #1968/#1971, not
completion evidence. No mode/feature/history field is sent, no rebinding is
attempted, and no caller-selected operation_id is invented for this endpoint.

## Validation boundary

Unit regressions use the existing HTTP shape and exact backend error strings.
The built-browser suite fixes the trusted Supervisor entry, Ultra mode and Work
side panel, and covers each availability state, zero Work, check-again recovery,
read-only flags, preserved draft and Ultra exit/re-entry without scope setup.
These are deterministic HTTP fixtures, not the user's actual server or real
model semantics. No paid model invocation, Rust compile, publication, push,
merge or persistent permission expansion is part of this slice.


Final local validation of this existing-contract slice: 144 unit files / 3,043
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


Confirmed initialization-client boundary validation: all 3,057 unit tests passed
(144 files), including 14 added exact-command/receipt/refusal cases. The existing
Work availability and owner-access built-browser regressions passed 33 cases on
the new bundle. Type-check, lint, i18n (2,079 keys), architecture, build and
package gates passed; no budget changed. These checks do not claim that an
initialization button or the producer's live endpoint has been accepted.

Remaining wire decisions: whether availability is a string or kind object; the
stable reason codes for Standard mode, stale binding and offline-only storage;
and the canonical HTTP conflict response. Successful scope must preserve its
readable health/overview/capabilities, not just a boolean. Disabled flags must
retain already-readable data. The frontend takes binding_revision from the
confirmed payload, never from root_mode_transition_epoch.
