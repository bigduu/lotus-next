# Repair release 2026.10.23 preparation

The original manual acceptance at `88488e05` preserved two failures: initial
asset requests reported `ERR_NETWORK_CHANGED`, then a single failed-job retry
reached a fully rendered permission page but Chromium 151 reported its completed
no-store bootstrap read as aborted and could not return its body to DevTools.
The latter matches Chromium issue 568852319. The repository already introduced
the fixed 157.0.8090.0 outer browser in `91f367f6` for publication. Current-source
CI now reuses those exact archive/executable pins and config-equivalence checks
in a separate verification record. It keeps the locked Playwright, original
configs, cases, device descriptors, inner browser, request/body assertions,
timeouts, retry policy, local/HTTPS modes and publication source authority.
Verification cannot accept a versioned package or write a publication identity.

This candidate pairs the accepted Lotus Next application with Bamboo
`80815125da51a5722935e99fda2ed4541aa67f98`. That normally merged backend includes
the retry diagnostic, ordinary Workspace handoff and setup/Core write repairs.
The frontend application sources remain those reviewed in PR400 at
`2a15589ae6bb0ea5a515ee9056d113213fd657f4`, merged as
`3f8af24e9c095026ca95aa5ed7334ef6e27be369`. This preparation updates the exact
backend acceptance pins and passes the verified publication version/source to
the frontend's existing public runtime metadata.

The diagnostics UI displays the backend's available receipt and exports only
the defined allowlist. A new run, conversation change or refresh reconciles its
own canonical diagnostic. Missing data remains missing; frontend exports do not
infer backend authority or issue another model request.

The retained local combination acceptance used Bamboo `0b3c7315` and the PR400
frontend snapshot: actual SSE, WebSocket and canonical diagnostic identity,
cold restart persistence and seven UI assertions passed, with twelve synthetic
provider requests and zero paid calls. The chat-only terminal replay observation
was unconfirmed and is not counted as passing. That receipt retains its original
source identities; it does not prove a later build. The new backend's necessary
setup path passed seven actual native assertions on the source-bound CLI:
normal incomplete/complete requests, Core-only revision changes, unchanged
Providers/credentials, cold restart persistence and minimal decoder compatibility,
with zero model requests.

The first original manual acceptance at `72948f44` retained a real browser
failure before chat: the service correctly returned `404 browser_not_open`,
while the older test expected an already opened empty scope. The updated tests
explicitly click the existing service-default open action and require its actual
`PUT 200` and empty request body. The original tabs, epoch, screenshot and model
assertions, test selection, retries, timeouts and thirteen-case gate remain.
That failed run is retained; it is not an accepted publication source receipt.

The next exact-source run at `05394096` passed the original build/chat step
(ten passed and three existing mode skips), then exposed a second stale
expectation in local artifact acceptance. Its trace proves one initial canonical
`GET 404` with the full `browser_not_open` error before the explicit `PUT 200`.
The observer now accounts for exactly that independently captured pre-open read
and its matching resource-console source. Wrong session/origin/error bodies,
repeated reads, later errors, unrelated HTTP/console errors and WS/SSE failures
still fail. The complete raw observation and validated receipt remain attached.
That original failed run and its local/secure results are retained unchanged.

Formal publication is still pending. The package source version stays `0.0.0`.
Before publishing the unused immutable `2026.10.23` identity, run the existing
exact-source Node22/24, package and real-Bamboo browser gates, normally merge
the source and reviewed immutable tag/acceptance registration, and use the
canonical publisher. Its final tarball must match the accepted browser bytes
and the registry readback. No consumer lock, historical release or platform
scope changes in this source preparation.
