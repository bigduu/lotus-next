# Browser profile modes

The browser workbench reads `GET /api/v1/browser/sessions/{session_id}` before opening anything. `404 browser_not_open` means the scope is closed, but does not establish profile support: older servers return the same code and ignore mode-bearing PUT bodies. No read, panel mount, chat selection or retry creates a browser.

An unreported closed scope offers only **Open using server defaults**. This explicit action sends one mode-free `PUT {}`. It works with the existing API without promising account sharing or isolation. Only a coherent BrowserState pair (`shared/true` or `clean/false`) enables the shared/clean selector. If a later state loses or contradicts that pair, the cached eligibility is discarded. A new server's first default open reports shared mode; choosing clean then requires separate close and open actions. No new capability field is inferred or invented.

After profile support is reported, an explicit mode open sends one `PUT` with only `{profile_mode: "shared" | "clean"}`. An explicit close sends one `DELETE` for the current chat. Both use the single-attempt transport, as does the default open. Selection alone sends nothing. A mode change requires separate close and open actions; a 409 never triggers automatic close, reopen, or replay.

Failed or pending canonical reads do not present a cached mode as current. Missing metadata remains unreported; contradictory metadata disables the new controls. Existing navigation and page dialogs remain available on older hosts. Shared Cookie/site storage is not a security boundary between chats. Clean sessions inherit neither shared state nor a previous clean session.

Browser JSON state/DOM reads also use single-attempt transport. A typed `503 browser_busy` is a known refusal, displays that the request was not performed, and stops automatic state-read recovery until the user retries. It does not close the current browser. Other 5xx or transport failures after an open/close remain unconfirmed outcomes. A fresh GET may recover the view, but no failure replays PUT or DELETE.

The hook fences actions by chat and request scope. After a write or ambiguous response it reads canonical state instead of applying a late ACK to another chat. Hiding the panel, selecting another chat, or retrying a read does not implicitly reopen a closed scope. A final-tab close returns an active, empty scope; the workbench may show its existing empty view until the browser entry is selected again.

The optional browser view is loaded separately from ordinary-chat startup. App keeps the existing state hook and chat ownership; loading or retrying the view never opens or closes a browser. Loading has a visible status, and a failed view import is contained in the workbench with an explicit retry action. The original startup byte ceilings remain unchanged, with the BrowserPane view also forbidden from the eager import graph.

## Verification boundary

Affected hook, selector, service and transport tests cover canonical reads, explicit defaults and modes, known refusals, single attempts, conflicts, unknown results, late ACKs and chat switches. Built-artifact Chromium fixtures simulate two chat scopes, empty tabs, clean reopen, conflict/busy/unknown recovery and the older host's typed404 with missing mode fields. Existing legacy pages/dialogs and the phone's absence of browser requests remain separate regressions.

These fixtures simulate HTTP responses. They do not establish that the Bamboo shared runtime is deployed, that real account cookies survive, or that backend chat page isolation works. Actual source-bound Bamboo HTTP/runtime validation remains required after its owner delivers the adapter. No real profiles or credentials are read or copied, and no backend, Rust, Bodhi, release pins or published artifacts are changed by this frontend work.

When the person explicitly opens an account mode, the browser entry remains selected even if the returned scope has zero tabs. This keeps profile controls and the empty-page entry available after close/reopen. Existing missing-page restoration and explicit page-close successor selection keep their original behavior.

An unconfirmed profile write remains explicitly unconfirmed if the following canonical read also fails. The view shows both that uncertainty and the read failure; a read retry never resends the write. A known `browser_busy` refusal remains distinct from an ambiguous write.
