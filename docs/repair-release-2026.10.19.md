# Repair release 2026.10.19

This bounded release pairs Lotus Next with Bamboo `a473f69b856962dd3dbdbfb2051b4fa4aa6e3041`. The product starts from the locally accepted `413168a6758ba1ef91fbb0ceca75f054365c00a0` candidate; its image, child-card, Supervisor and compatibility changes are already integrated. The separate `63ae3cf06f41c4b76b421d43ba3698da528e4a20` consumer branch adds tests and documentation without another production behavior change.

## Included behavior

- Keep acknowledged image thumbnails visible until the exact canonical message arrives, including image-only messages and execution refusal. Acknowledgements arriving after navigation are retained without taking over the viewed pane. Each acknowledged operation remains separately visible while the user sends again in the same session or switches sessions and sends elsewhere; only its own canonical message retires that operation.
- Start child cards compact, preserve their expansion choice, and keep authoritative lifecycle and creation origin visible. Opening the original conversation remains explicit. First-creation placement recognizes matched legacy `action:create`/`child_session_id` and compact chat-without-target/`actor_id` results. Inspect, target chat, control and parent replies never supply creation evidence.
- Show backend compatibility reports, allow compatible legacy sessions, and block only explicit execution conflicts while preserving history and drafts. Reconnect rereads the current session without sending or migrating anything. If a changed queued input is definitively refused for compatibility, the earlier uncertain guidance receipt is restored for an explicit retry of that earlier input.
- Preserve Work ready-empty, uninitialized, disabled, forbidden and error states. Initialization remains an explicit, capability-gated action. Project scope uses the same existing-access HTTP API in browser and desktop; it adds no login or native requirement.
- Consume ordinary runtime progress-exhaustion summaries and canonical pending state. No new progress question means no dialog; genuine permissions and already persisted questions still require Human response.

The paired Bamboo commit includes PR2078 (compatibility), PR2085 (private model progress feedback), PR2087 (image context handling), and PR2089 (compact/shared workspace prerequisites). Child workspace behavior is not a claim of the unfinished versioned independent-Root spawn contract.

## Pending acknowledgement lifecycle

The pending queue is scoped by operation and Session. Before acknowledgement, the composer retains the submitted draft and attachments; the synchronous submission fence prevents a second POST from creating reverse ACK ownership in the same pane. After acknowledgement, navigation cannot discard the accepted content or take over another pane's subscription.

| Boundary | Regression coverage |
| --- | --- |
| Existing/new Session, image-only/captioned, navigation before ACK | Late ACK stays with the acknowledged Session; no forced navigation or foreign subscription |
| Navigation after ACK, subsequent text/image send | Each operation remains visible on return, independently of other Sessions |
| Consecutive sends and canonical arrival in either order | Explicit message IDs retire only their matching operation |
| Older ACK without message ID, including mixed old/new ACKs | New canonical IDs are consumed once; a later in-flight POST cannot reuse an earlier match |
| Unconfirmed submit or compatibility refusal | No automatic resend; retain the draft or previous uncertain guidance receipt for explicit recovery |
| Failed auxiliary hydration or stale complete/error/cancelled history | Keep accepted images until canonical user-message evidence arrives |
| Immediate Stop and WebSocket reconnect | Stop targets its owned run; canonical reconciliation retires the matching payload without another send |

Old ACKs lacking IDs retain the existing text/baseline fallback and consume distinct canonical IDs in history order. They cannot prove the exact identity of two indistinguishable, out-of-order messages before either ACK supplies an ID. Explicit-ID regressions cover reverse canonical arrival; legacy browser regressions use chronological canonical arrival. These regressions do not grant permissions or decide model capabilities.

## Evidence and release identity

Prior source-bound local unit and browser evidence is retained. The actual 1f/413 plain-browser acceptance passed eight desktop/phone cases with real WebSocket reconnects, zero writes and unchanged fixture bytes. It used System-only fixture history and does not prove a User/Assistant execution or the final a473 combination. Existing image and feedback browser cases use synthetic contracts; final combination acceptance is tracked separately. PR383 review also reproduced a cross-session pending-image overwrite in two cases (the second session sends text or another image); the fix keeps separate pending entries and retires each only when its own exact acknowledgement reaches canonical history.

The checked-in package version remains the repository's intentional `0.0.0` source placeholder. Formal publication must inject `2026.10.19` through the existing immutable accepted-source workflow, complete the exact-source Node22/24 and paired Real Bamboo checks, and verify the published registry artifact. A local placeholder manifest is not a released package.

## Excluded work

Unfinished Tickets, independent spawn v2, selective continuation, and the unconfirmed other-machine retry incident are not delivered here. This release does not change authentication or permission policy, attach historical sessions, expand Project scope, configure a real model, or add Bodhi business logic.
