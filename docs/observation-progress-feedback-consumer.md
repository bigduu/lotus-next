# Observation progress feedback — Lotus consumer boundary

This independent tests/documentation slice reuses [Bamboo #2016](https://github.com/bigduu/Bamboo-agent/issues/2016), related to [#1755](https://github.com/bigduu/Bamboo-agent/issues/1755). It starts from accepted Lotus `9ba641cf`; frozen #2077 `7eb9574` and its `8dea054` artifact are unchanged. No Bodhi/native code is involved.

## Current source findings

The page opens questions from the canonical `GET /api/v1/respond/{id}/pending`, never from repeated content, diagnostic counters, completion metadata or an event's display text. `AgentService.parsePendingQuestion` accepts canonical none, typed clarification and typed permission, rejecting malformed or foreign permission identity. `useChat.reconcileQuestion` fences stale reads and keeps pending/uncertain submissions distinct from absence. `need_clarification` is a notification that triggers a fresh GET, not decision authority.

`QuestionDialog` renders ordinary persisted clarification options/custom input. `useChat.submitQuestion` sends one explicit `respond/{id}` with `{response,expected_tool_call_id}`. A current typed permission is separate: only the advertised allow/deny once choices can submit the exact request ID, opaque generation and policy revision through `permission-decisions`. Continuation belongs to Bamboo; observing an acknowledged continuation does not issue a new execute request.

The existing generic history mapper accepts optional raw message metadata and displays ordinary Assistant text. The HTTP `HistoryResponse` TypeScript declaration does not name arbitrary message metadata; the test fixture explicitly adds that optional raw field rather than claiming the public DTO already declares it. It currently keeps reasoning metadata for Assistant text and does **not** propagate arbitrary `runtime_kind` into the rendered message. Session `runtime.completion_reason` is not used as execution or permission authority. No new marker-specific UI branch is needed for the ordinary honest summary to remain visible. The backend must state unfinished work in the persisted summary text itself; Lotus does not infer task success from a marker or fabricate a result.

## Producer/consumer agreement to validate

New repetition diagnostics are private structured facts sent only to the same LLM. They are not a new business HTTP/WS DTO or a human question. They must not create an `observation_progress` PendingQuestion, suspend with `awaiting_clarification`, emit `NeedClarification`, or require Lotus to auto-Continue or hide a real pending request.

The source-frozen, runtime-unverified backend budget is at most three diagnostic episodes per execution, four recovery model rounds per episode. New output/evidence may end an episode without refunding the total. Budget accounting, private feedback content and model scheduling remain entirely backend behavior; these frontend fixtures do not prove those limits.

On exhaustion, Bamboo persists one runtime-authored Assistant message with its normal ID/created_at/nonempty content and honest unfinished text, preserves real call/result pairing, settles the run and uses the existing history-committed, agent terminal-control and account-feed publication path. The summary is not a fabricated tool call or result. A semantic Complete frame alone does not stand in for the existing transport termination/durable-summary notifications. Frozen optional annotations are Session metadata `runtime.completion_reason="observation_progress_exhausted"` and Message metadata `{runtime_kind:"observation_progress_exhausted",source:"runtime",progress_feedback:<bounded text>}`. These fields do not create frontend authorization or a pending-state rule; Lotus does not parse `progress_feedback`. The ordinary notice uses the exact unchanged-file text frozen at Bamboo `5af6c01c`; the opaque feedback value in these consumer fixtures is synthetic, not a captured LLM packet. No extra summary model, process cancellation, credentials or permission change belongs to this consumer slice.

Existing durable `observation_progress` questions remain real until the canonical endpoint says otherwise. Continue, Stop and a custom answer use the existing guarded response transaction. A read failure is not absence. Typed permission/generation and genuinely gated tools still require explicit user input even when an earlier run has exhaustion metadata. A fresh reload/connection reads current canonical pending instead of replaying an old progress answer.

## Isolated verification scope

Only new fixture/unit/framework/browser files are added; product source is unchanged. Built-browser checks reuse the immutable accepted `9ba641cf` dist (manifest SHA256 `978570e5eb046b168237bd805ea35d215ac7a9bc0591a7a27ea88c9566d9a788`), without rebuilding or touching that artifact. Checks cover ordinary summary display with real tool pair IDs, canonical none, persisted progress Continue/Stop/custom, unavailable pending refresh, current typed generation after a full browser reload/new connection, and explicit denial without automatic execute/tool submission.

These are synthetic HTTP/WS consumer fixtures, not a compiled current Bamboo producer, actual private LLM payload inspection, native WebView acceptance or a paid-model result. True budget/episode behavior, absence of new producer questions, runtime-authored summary persistence and current-source end-to-end integration remain backend validation dependencies. The delivery receipt records actual test outcomes and source/artifact identities.


## Local outcomes

The new unit/component file passes 7 cases. Its first invocation was 6P/1F because the fixture asserted raw `content` on a mapped tool-result row; the existing UI stores that value under `result.result`. Correcting only the assertion made all seven pass. Initial type checks also exposed fixture-only raw-metadata and application-vs-Node import boundaries; the self-contained browser fixture now validates structurally through the real hook and mapper without changing the public DTO or compiler settings.

The first built-browser invocation was 8P/2F. Both failures already rendered the summary and no dialog; the fixture omitted the standard agent terminal control and account durable-change feed, leaving the old running summary visible. Only the new-feedback fixture was corrected to supply those existing frames, and only its desktop/phone cases were rerun: 2P. Final coverage is 8 first-run passes plus 2 corrected-case passes, not a fresh ten-case invocation. No product code, frozen asset or real backend was changed. Failed logs/traces are preserved separately from the passing results.


## Frozen producer-source alignment

Bamboo `5af6c01c982457bb075875288c41fd804afe1940` / tree `c037524ac42345b46188ddf2fd04d97120cee259` freezes the producer-side fields above. Owner source receipt SHA256 is `b424eba0003bf58858d591808bddbe09322cd0184f22aba3c2338e9ac5fa8663`; its patch SHA256 is `80aaa779c66a62bc8acf91d135c67940b7bfbec97ca928a45d7ae82b2f927425`. Both were read-only verified. The legacy match, retain, resume, Stop and suspension function bodies were compared to actual dev `3056010d` byte for byte; this is static source evidence, not runtime validation.

The follow-up changes only the existing tests/fixtures/documentation: exact ordinary notice text, all three optional metadata fields, and the same metadata-bearing history coexisting with canonical typed permission after a browser reload. Only affected summary/permission selections were rerun: 2 unit/component passes (5 other cases filtered) and 4 desktop/phone framework passes. Type-check and lint pass. Original `c93b011` 7-case and 10-case records remain historical evidence; no aggregate is relabelled as a fresh all-case run. No new build, producer execution or real HTTP/WS integration is performed. All Bamboo Rust/fmt/test results for this producer remain UNRUN in the supplied handoff; the backend's #2077 Server RED resource window is not touched.

## Same-document WebSocket recovery

A separate new desktop/phone fixture now closes the routed WebSocket twice while keeping the same document alive (one main navigation). Existing account-feed `onReconnected` reconciliation rereads canonical pending. The initially shown legacy progress question is replaced by the current typed permission generation; a second reconnect sees canonical absence and clears the dialog. Exhaustion history remains visible, and no response, permission decision, execute, Stop or other POST is sent. Both device cases passed on the unchanged 9ba artifact. This adds in-place transport coverage to the earlier full-reload fixture; it does not turn the synthetic server into current Bamboo integration, rerun old cases, or require a new product build.
