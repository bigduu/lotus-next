# Local trace viewer

The current session's **Local traces** action opens a list, a parent/child span
timeline and an allowlisted detail view. It uses Bamboo's authenticated native
API; it is not an OTLP receiver and needs no external collector. Status filtering
applies only to the currently loaded page. Pagination uses the server's opaque
cursor. The in-memory span limit, this session's known eviction count and the
restart boundary are shown when the server reports them. The view labels
best-effort coverage and is not a billing ledger. A partial trace can result
from a missing parent, retention or a dropped insertion.

The v1 adapter reads `GET /sessions/{session_id}/traces?limit=50[&cursor=…]`
and `GET /sessions/{session_id}/traces/{trace_id}` under the installed API base.
It checks the schema version and session identity, rejects malformed or
duplicated trace/span identifiers, and projects only timing, status, kind,
model, provider and usage. It does not render arbitrary span names, attributes,
errors, prompts, responses, tool bodies, keys or paths. Model and provider
identifiers still depend on Bamboo’s identifier policy; syntactically valid
identifiers must not contain secrets. Unavailable usage is shown as unknown;
zero is preserved. Cache creation and cache write remain
separate. Input, output, cache and reasoning values are never added together.

`src/services/traces/localTraces.test.ts` exercises the v1 wire fixture and
`e2e/local-traces.spec.ts` renders the built app using synthetic responses.
Those fixtures do not prove a real Bamboo round trip. The backend contract and
runtime are being implemented in parallel; verify session isolation, retention,
authentication and the same UI against the resulting real backend before
admission. Recheck the live contract and current Dev base at integration time.

## Real-backend acceptance

1. Start an isolated, loopback-only Bamboo built from the reviewed trace
   implementation with a recorded source revision and executable digest. Serve
   the exact Lotus artifact under test, use a disposable data directory and a
   synthetic provider, and leave outbound OTLP disabled. Do not substitute an
   older published binary.
2. Create two synthetic sessions. Complete at least two distinct traces in the
   first and one in the second; wait for them to settle. For UI pagination at
   the panel’s fixed page size of 50, create at least 51 distinct traces in the
   first session. Place distinct synthetic prompt, tool-body, path and
   credential sentinels in the fixture.
3. Read the first session with `limit=1` and its opaque next cursor; verify two
   distinct trace IDs, session identity, coverage and retention metadata. Read
   the second session, verify disjoint IDs, and require 404 for each session's
   attempt to read a trace belonging only to the other. Check `private,
   no-store` and that sentinels are absent from list and detail responses.
4. In the actual Lotus artifact, open each session's panel and compare the
   displayed span tree, status, durations and usage with its corresponding
   response, including an explicitly reported zero and a null. Exercise a
   session switch during an interrupted read, refresh, cursor navigation and
   desktop/phone layout. Capture only synthetic data, and retain the runtime,
   artifact and source identities with the results.

Live checks were run against Lotus `1d1c7aae276b4bc254b0815f445951a3a091fcd5`
and Bamboo candidate `14e70a222be7138cdae07363ef5398cb26134a1e` using
synthetic sessions and a synthetic provider. They covered 51 traces across
two pages, bidirectional session isolation, tool spans, zero versus unknown
usage, and desktop and phone layouts. The separately configured disabled
instance was also checked at both sizes. The browser
overrode only the setup-status read; trace responses came from Bamboo, and a
503 was deliberately injected to exercise refresh recovery. See the PR for
the executable digest and validation details.

Repeat the applicable checks for any later Bamboo candidate before admission;
this result does not establish acceptance of a different backend revision.
