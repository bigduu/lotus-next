# Browser profile modes

The browser workbench reads `GET /api/v1/browser/sessions/{session_id}` before opening anything. A canonical `404 browser_not_open` offers an explicit choice: **Shared account** (default) or **Clean session**. It does not create a browser. A generic legacy 404 without a business code retains the older mode-free `PUT {}` entry; this fallback is disabled after that chat reports the profile contract.

An explicit open sends one `PUT` with only `{profile_mode: "shared" | "clean"}`. An explicit close sends one `DELETE` for the current chat. Both use the single-attempt transport. Selection alone sends nothing. A mode change requires separate close and open actions; a 409 never triggers an automatic close, reopen, or replay.

Every current state reports a coherent pair: `shared/true` or `clean/false`. Failed or pending canonical reads do not present a cached mode as current. Missing metadata remains unreported; contradictory metadata disables the new profile controls. Existing navigation and page dialogs remain available on older hosts without claiming shared storage. Shared Cookie/site storage is not a security boundary between chats. Clean sessions inherit neither shared state nor a previous clean session.

The hook fences actions by chat and request scope. After a write or an ambiguous response it reads canonical state instead of applying a late ACK to another chat. Hiding the panel, selecting another chat, or retrying a read does not implicitly reopen a closed scope. A final-tab close returns an active, empty scope; the workbench may show its existing empty view until the browser entry is selected again.

## Verification boundary

Affected hook, selector, service and transport tests cover canonical reads, explicit choices, single attempts, conflicts, unknown results, late ACKs and chat switches. Built-artifact Chromium fixtures cover two chat scopes, empty tabs, clean reopen, conflict/unknown recovery, legacy pages/dialogs and the phone's existing absence of browser requests.

These fixtures simulate the HTTP responses. They do not establish that the Bamboo shared runtime is deployed, that real account cookies survive, or that backend chat page isolation works. Actual source-bound Bamboo HTTP/runtime validation remains required after its owner delivers the adapter. No real profiles or credentials are read or copied, and no backend, Rust, Bodhi, release pins or published artifacts are changed by this frontend work.
