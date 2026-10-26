# Lotus Next verification and packaging

[Back to README](../README.md)

## Verification gates

Run the same checks locally that CI runs for pull requests and `main`:

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

CI splits this unchanged all-surface inventory into four independently rerunnable
shards per Node lane. See [browser shard evidence, reruns, and timing](browser-test-shards.md).

The real-runtime gate is intentionally separate from that deterministic
matrix. It verifies a clean checkout of Bamboo revision
`d6325a732c7669f94962f604e4ce98966e374d73`, pairs its browser host with the
hash-verified published Bamboo `2026.10.18` Linux x64 executable, and assembles
an isolated Docker image without compiling Bamboo. It serves the production
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
Bamboo checkout and never accepts a live Bamboo URL. Normal completion, setup
failure, `SIGINT`, and `SIGTERM` share one exact-resource teardown for the two
containers, private network, temporary image, observation mount, and data root
it created. CI runs this single desktop lane once on Node 22; it does not repeat
it across the mock suite's viewport/runtime matrix.

The published-artifact acceptance is a second real-runtime lane. It downloads
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

The committed package version remains the `0.0.0` source placeholder. The
manual publication workflow accepts one explicit SemVer and reuses the complete
Node 22/24 and browser source-CI results bound to the exact clean candidate in
the committed acceptance receipt. It does not rerun that Node test matrix or
`npm run verify`. Publication builds the versioned artifact, checks it against
the paired real Bamboo runtime on local and HTTPS browser surfaces, then builds
and statically verifies the final package and requires its tarball to match the
accepted runtime identity. It packs without another lifecycle build, publishes
with npm provenance, and downloads and verifies the registry copy. Publishing
does not switch any Bamboo, Bodhi, or Zenith consumer.

Each publication build also supplies `VITE_APP_REVISION` and `VITE_APP_VERSION`
from the same verified source receipt and explicit package version. Runtime
diagnostic exports can therefore identify that exact published frontend; local
builds without those public values continue to report an unknown identity.

Publication preflight checks the accepted candidate's files at its exact source
SHA. CI must pin that candidate's Bamboo SHA literally; publication may use the
same literal (historical candidates) or the exact
`${{ needs.preflight.outputs.bamboo_sha }}` binding. The latter obtains its SHA
from the reviewed candidate and the run-bound source receipt, rather than a
dispatch input or moving backend ref. Preflight also checks that this binding
is in the real-Bamboo job's environment, that the preflight output maps to
`steps.source.outputs.bamboo_sha`, and that this source step runs the release
authority script. The paired Bamboo checkout must consume that environment
binding from the official repository into `.e2e-bamboo`, with only the reviewed
plain block keys and action inputs. Step environments, merged or quoted keys,
duplicate mappings, and unreviewed inputs fail closed. This strengthens
preflight rejection; the existing runtime gate still checks the exact Bamboo
checkout SHA independently.
The source authority step also requires its reviewed plain block shape and
four exact environment inputs, without step execution overrides or inherited
workflow/preflight run defaults. Preflight job environments are rejected, and
the workflow environment accepts only the seven reviewed plain, unique entries
with exact values. The real-Bamboo job environment likewise requires its six
reviewed plain, unique entries and exact values. Both jobs permit only their
current plain, unique top-level keys, rejecting added container execution and
other wrappers without interpreting them. The parent job-name mapping requires
plain, unique keys, and preflight outputs require their six reviewed plain,
unique, flat entries, preventing equivalent quoted or merged overrides.
The current publication graph contains preflight, real-Bamboo acceptance and
pack/publish, with publication waiting for both preceding gates. Historical
candidate sources retain their four-job graph with the additional Node
verification dependency; their receipts and tags remain unchanged.
These checks prevent inherited execution overrides such as `NODE_OPTIONS` from
changing how the source script or paired checkout runs. This bounded structural check
does not evaluate arbitrary other steps, file mutations, action supply chains,
or general YAML.
Missing, duplicate, or mismatched workflow bindings are
rejected without changing the tag, tree, acceptance, or workflow identity gates.

The initial bundle-size baseline is recorded in [`docs/bundle-baseline.md`](bundle-baseline.md). It is an observation gate, not a size-budget change.
