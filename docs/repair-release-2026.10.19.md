# Repair release 2026.10.19

This bounded release pairs Lotus Next with Bamboo `a473f69b856962dd3dbdbfb2051b4fa4aa6e3041`. The product starts from the locally accepted `413168a6758ba1ef91fbb0ceca75f054365c00a0` candidate; its image, child-card, Supervisor and compatibility changes are already integrated. The separate `63ae3cf06f41c4b76b421d43ba3698da528e4a20` consumer branch adds tests and documentation without another production behavior change.

## Included behavior

- Keep acknowledged image thumbnails visible until the exact canonical message arrives, including image-only messages and execution refusal. Each session retains its own pending acknowledgement while the user switches sessions and sends elsewhere.
- Start child cards compact, preserve their expansion choice, and keep authoritative lifecycle and creation origin visible. Opening the original conversation remains explicit.
- Show backend compatibility reports, allow compatible legacy sessions, and block only explicit execution conflicts while preserving history and drafts. Reconnect rereads the current session without sending or migrating anything.
- Preserve Work ready-empty, uninitialized, disabled, forbidden and error states. Initialization remains an explicit, capability-gated action. Project scope uses the same existing-access HTTP API in browser and desktop; it adds no login or native requirement.
- Consume ordinary runtime progress-exhaustion summaries and canonical pending state. No new progress question means no dialog; genuine permissions and already persisted questions still require Human response.

The paired Bamboo commit includes PR2078 (compatibility), PR2085 (private model progress feedback), PR2087 (image context handling), and PR2089 (compact/shared workspace prerequisites). Child workspace behavior is not a claim of the unfinished versioned independent-Root spawn contract.

## Evidence and release identity

Prior source-bound local unit and browser evidence is retained. The actual 1f/413 plain-browser acceptance passed eight desktop/phone cases with real WebSocket reconnects, zero writes and unchanged fixture bytes. It used System-only fixture history and does not prove a User/Assistant execution or the final a473 combination. Existing image and feedback browser cases use synthetic contracts; final combination acceptance is tracked separately. PR383 review also reproduced a cross-session pending-image overwrite in two cases (the second session sends text or another image); the fix keeps separate pending entries and retires each only when its own exact acknowledgement reaches canonical history.

The checked-in package version remains the repository's intentional `0.0.0` source placeholder. Formal publication must inject `2026.10.19` through the existing immutable accepted-source workflow, complete the exact-source Node22/24 and paired Real Bamboo checks, and verify the published registry artifact. A local placeholder manifest is not a released package.

## Excluded work

Unfinished Tickets, independent spawn v2, selective continuation, and the unconfirmed other-machine retry incident are not delivered here. This release does not change authentication or permission policy, attach historical sessions, expand Project scope, configure a real model, or add Bodhi business logic.
