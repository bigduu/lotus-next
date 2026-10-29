# Local trace viewer

The current session's **Local traces** action opens a list, a parent/child span
timeline and an allowlisted detail view. It uses Bamboo's authenticated native
API; it is not an OTLP receiver and needs no external collector. Status filtering
applies only to the currently loaded page. Pagination uses the server's opaque
cursor. The in-memory span limit, this session's known eviction count and the
restart boundary are shown when the server reports them. A partial trace may
have missing parents.

The v1 adapter reads `GET /sessions/{session_id}/traces?limit=50[&cursor=…]`
and `GET /sessions/{session_id}/traces/{trace_id}` under the installed API base.
It checks the schema version and session identity, rejects malformed or
duplicated trace/span identifiers, and projects only timing, status, kind,
model, provider and usage. It does not render arbitrary span names, attributes,
errors, prompts, responses, tool bodies, keys or paths. Unavailable usage is
shown as unknown; zero is preserved. Cache creation and cache write remain
separate. Input, output, cache and reasoning values are never added together.

`src/services/traces/localTraces.test.ts` exercises the v1 wire fixture and
`e2e/local-traces.spec.ts` renders the built app using synthetic responses.
Those fixtures do not prove a real Bamboo round trip. The backend contract and
runtime are being implemented in parallel; verify session isolation, retention,
authentication and the same UI against the resulting real backend before
admission. Recheck the live contract and current Dev base at integration time.
