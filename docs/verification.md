# Lotus Next verification and packaging

[Back to README](../README.md)

## Verification gates

Run the same checks locally that feature CI runs before admission to `dev`:

```bash
npm ci
npx playwright install chromium
npm run verify
npm run test:e2e:built
```

`npm run verify` produces the production artifact after the type, lint, unit,
architecture, bundle, and package checks. `npm run test:e2e:built` then exercises
that exact output in Chromium at desktop, tablet, and phone viewports. Use
`npm run test:e2e` as the standalone convenience command when you need it to
build first. The browser suite checks standalone, secure remote, and nested
embedded hosting while enforcing the canonical `/api/v1` and `/v2/stream`
runtime contract. CI retains its HTML report, trace, screenshot, video, and
runtime observations when a case fails.

CI runs the Unit suite once on Node 22 and builds its canonical test artifact
once on Node 24. Four independently rerunnable shards consume that artifact
across the complete all-surface inventory. See
[browser shard evidence, reruns, and timing](browser-test-shards.md).
Feature CI also requires real Bamboo and native Actor E2E. Its `Feature acceptance`
gate binds the actual PR merge snapshot, base/head and tree and rejects skipped
or failed required jobs. It does not rerun tests on main pushes. The candidate
also contains the single-artifact publisher and read-only Main admission. See
[delivery and cutover status](delivery.md) and the installed workflow before
releasing; a reviewed source change alone is not production publication evidence.

The real-runtime gate is intentionally separate from that deterministic
matrix. It verifies a clean checkout of Bamboo revision
`4786b7db862cabbebce49e288da62b284ccf5b72`, pairs its browser host with the
hash-verified published Bamboo `2026.10.19` Linux x64 executable, and assembles
an isolated Docker image without compiling Bamboo. CI verifies the exact host
and browser-adapter objects from that same checkout. The image records the
source revision and host SHA-256, which the browser test checks against the file
inside the running container. Static checks alone do not establish runtime
compatibility. It serves the production
Lotus Next artifact from that Bamboo process and drives
one complete chat turn through the visible desktop UI and a local deterministic
OpenAI-compatible provider. It requires the `auth.ws_hello_ack.v1` bootstrap
capability and records one ordered, bidirectional WebSocket timeline for both
the initial page and a fresh browser context, proving that exact `hello` is
acknowledged by exact `welcome` before any subscription is sent. The provider
shares Bamboo's test-owned network
namespace and listens only on that namespace's loopback interface; only Bamboo's
HTTP or in-process rustls TLS listener is published on a random host-loopback
port. The provider writes redacted observations atomically to a test-owned bind
mount instead of exposing its own API to the host.
Both Bamboo data and its Jiandu home stay inside a separate
test-owned temporary `/data` mount, so the lane never reads the workstation's
live Bamboo or Jiandu state. To run it locally, provide the absolute path to a
clean checkout at that exact revision:

```bash
BAMBOO_E2E_SOURCE_DIR=/absolute/path/to/bamboo \
  npm run test:e2e:real-bamboo
```

Docker and Chromium are required. The runner rejects a different or dirty
Bamboo checkout and never accepts a live Bamboo URL. Feature CI uses the same
clean checkout for both binary source and host verification; publication inputs
cannot select the feature-only host path. Normal completion, setup
failure, `SIGINT`, and `SIGTERM` share one exact-resource teardown for the two
containers, private network, temporary image, observation mount, and data root
it created. CI runs this single desktop lane once on Node 24; it does not repeat
it across the mock suite's viewport/runtime matrix. It runs on every feature PR
using the already verified Node 24 `dist`; it does not rebuild that output.

The feature job also packs the already-built current-source artifact without a
new Vite build, then verifies it on local HTTP and HTTPS/WSS browser surfaces.
The separate manual published-artifact diagnostic downloads
`@bigduu/lotus-next@2026.9.14` from the public npm registry into a fresh cache
with lifecycle scripts disabled, then requires the committed SHA-1, SHA-512
integrity, manifest SHA-256, resource-set digest, 34-resource inventory, and
source revision `ae17b50574ccd86395cbc226b50c9fb2f0f51e0f`. It refuses any
different artifact before launching Bamboo. The same verified bytes are tested
first through native loopback HTTP and then through Bamboo's own HTTPS/WSS
listener using an ephemeral one-day certificate for `remote.lotus.test`.
Desktop, tablet, and phone viewports must keep the shell, settings, and composer
usable while every application request remains same-origin on canonical
`/api/v1` and the single `/v2/stream` WebSocket.

Run the immutable public-artifact lane with the same clean Bamboo checkout:

```bash
BAMBOO_E2E_SOURCE_DIR=/absolute/path/to/bamboo \
  npm run test:e2e:published-bamboo
```

This command additionally requires `openssl`. It creates no public tunnel: the
named remote topology resolves only to `127.0.0.1`, and the self-signed
certificate is trusted only by the ephemeral test processes. It proves the
browser contract and responsive viewports, not a physical-device or
public-network path. HTML reports and Playwright artifacts are written to the
`playwright-report-real-bamboo-{local,remote}` and
`test-results-real-bamboo-{local,remote}` directories; runtime identity and
redacted observations remain under `test-results-real-bamboo/{local,remote}`.
CI uploads all three evidence roots even when a lane fails.

`npm run pack:check` rebuilds the app, asks npm for the exact dry-run tarball
manifest, and rejects anything outside `dist/` plus npm's required package
metadata. Every build also writes `dist/lotus-next-manifest.json`. That
versioned universal-web manifest binds the package name/version, exact source
revision and dirty state, relative `index.html` entrypoint, and every other
regular `dist/` resource by portable path, byte size, and SHA-256. Its combined
digest is deterministic for one resource set. Consumers must verify this file
before serving or staging an artifact; a dirty source manifest is never a
release artifact.

## Publication and recovery

The committed package version remains the `0.0.0` source placeholder. After
feature acceptance, the publisher trusts the normal PR merge into protected Dev
and verifies the admitted source, its parents/tree and frozen release tag. It
builds the formal-version dist once,
packs one original tgz without lifecycle scripts, retains those bytes and then
publishes and verifies them against the registry. It does not rerun Unit, browser
or real-Bamboo tests during release. Publication does not switch Bamboo, Bodhi
or Zenith consumers automatically.

The build supplies `VITE_APP_REVISION` and `VITE_APP_VERSION` from the verified
source and release version. Historical candidate records and workflow fixtures
remain available for their original receipts; they do not authorize a new cut.
The [pre-cutover verification guide](https://github.com/bigduu/lotus-next/blob/db0fe8bad768c98fbcc28f090763327061268d69/docs/verification.md)
retains the original candidate-graph and binding details for historical recovery.
See [delivery.md](delivery.md) for the current source, retry and promotion gates.

The initial bundle-size baseline is recorded in [`docs/bundle-baseline.md`](bundle-baseline.md). It is an observation gate, not a size-budget change.
