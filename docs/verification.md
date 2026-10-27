# Lotus Next verification and packaging

[Back to README](../README.md)

## Verification gates

Run the same checks locally that feature CI runs before admission to `dev`, from
one clean Node 24 checkout. Keep that source and its verified `dist` unchanged
through the built browser and real-runtime commands below:

```bash
npm ci
npx playwright install chromium
npm run verify
npm run test:e2e:built
```

`npm run verify` runs lint, theme/i18n, Unit, architecture and package checks
and produces the canonical artifact with its TypeScript/Vite build. `test:e2e:built` consumes
that output at desktop, tablet and phone viewports without another build.
`test:e2e` is the standalone convenience command that builds first; do not add
it after `verify`. The browser suite checks standalone, secure remote and nested
embedded hosting against canonical `/api/v1` and `/v2/stream` contracts. CI
retains HTML reports, traces, screenshots, video and runtime observations on failure.

CI retains Node 22/24 Unit compatibility and builds its canonical test artifact
once on Node 24. Four independently rerunnable shards consume that artifact
across the complete all-surface inventory. See
[browser shard evidence, reruns, and timing](browser-test-shards.md).
Feature CI also requires real Bamboo and native Actor E2E. Its `Feature acceptance`
gate binds the actual PR merge snapshot, base/head and tree and rejects skipped
or failed required jobs. The staged workflow has no Main-push repetition. See
[delivery and cutover status](delivery.md): the single-original publisher and
Main loader are staged; local diagnostics do not activate them or replace
complete hosted feature acceptance.

### Current-source real Bamboo checks without another build

The real-runtime gate verifies a clean checkout of Bamboo revision
`d6325a732c7669f94962f604e4ce98966e374d73`, pairs its browser host with the
hash-verified published Bamboo `2026.10.18` Linux x64 executable, and assembles
an isolated Docker image without compiling Bamboo. It serves the same verified
Lotus Next `dist` and drives a chat turn with a deterministic local provider.
The ordered WebSocket timeline proves exact `hello`/`welcome` acknowledgment
before subscriptions in the initial page and a fresh browser context.

Use the same fixed verification-browser commands as feature CI. They require
Docker, `openssl` and a clean checkout at that exact Bamboo revision. Set the
browser root to a fresh absolute directory named `verification-browser`, outside
the source tree, with an existing canonical parent. The helper selects the
committed browser pin and verifies its download and executable identity.
The `install-deps` line below installs Linux system dependencies as in CI; omit
that Linux-only line on macOS ARM64, where the helper selects its existing Mac pin.
The FFmpeg recorder remains required.

```bash
export BAMBOO_E2E_SOURCE_DIR=/absolute/path/to/bamboo
LOTUS_VERIFICATION_BROWSER_ROOT=/absolute/path/to/owned-scratch/verification-browser
npx playwright install-deps chromium
npx playwright install ffmpeg
node scripts/verification-browser.mjs prepare "$PWD" "$LOTUS_VERIFICATION_BROWSER_ROOT"
node node_modules/@playwright/test/cli.js test \
  --config="$LOTUS_VERIFICATION_BROWSER_ROOT/real-bamboo.config.mjs"
node scripts/published-real-bamboo-acceptance.mjs --current-source \
  --verification-browser "$LOTUS_VERIFICATION_BROWSER_ROOT"
```

The first browser command runs the original round trip. The `--current-source`
command packs that same `dist` with lifecycle scripts disabled, checks the
package against its source manifest, and verifies the packed bytes on loopback
HTTP and Bamboo's HTTPS/WSS surfaces. It performs no Vite build, registry publish
or old-package substitution. Both commands use the same fixed browser; the
ordinary mock shards above use their own Playwright Chromium configuration.

`npm run test:e2e:real-bamboo:built` is the no-build convenience command for the
ordinary `playwright.real-bamboo.config.ts` configuration. It does not select the
fixed verification browser; use the explicit config above to match CI.
`npm run test:e2e:real-bamboo` expands to a build followed by that `:built` command
and is only a standalone build-first convenience, not the next step after `verify`.

The provider listens on its test-owned network namespace's loopback interface;
only Bamboo HTTP or in-process rustls TLS reaches a random host-loopback port.
Bamboo data and Jiandu home stay in a separate temporary `/data` mount. The gate
rejects a different or dirty Bamboo checkout and never accepts a live Bamboo URL.
Setup failure, normal completion, `SIGINT` and `SIGTERM` share exact-resource
teardown for their containers, network, image, observation mount and data root.
It does not read the workstation's live Bamboo or Jiandu state.

The secure topology uses an ephemeral certificate for `remote.lotus.test`,
resolves only to `127.0.0.1`, and creates no public tunnel. Desktop, tablet and
phone retain same-origin API and WebSocket behavior. HTML reports and artifacts
use `playwright-report-real-bamboo-{local,remote}` and
`test-results-real-bamboo-{local,remote}`; redacted runtime observations use
`test-results-real-bamboo/{local,remote}`. CI uploads evidence even on failure.
These are isolated browser/runtime checks, not physical-device or public-network proof.

### Historical fixed public-artifact diagnosis

The no-argument published-artifact command is a separate manual diagnosis of
`@bigduu/lotus-next@2026.9.14`, not the current feature lane. It downloads with
lifecycle scripts disabled and checks the committed SHA-1, SHA-512 integrity,
manifest SHA-256, resource-set digest, 34-resource inventory and source revision
`ae17b50574ccd86395cbc226b50c9fb2f0f51e0f` before testing those old bytes on
loopback and HTTPS/WSS. It neither builds nor publishes a package.

```bash
BAMBOO_E2E_SOURCE_DIR=/absolute/path/to/bamboo \
  npm run test:e2e:published-bamboo
```

Preserve its original fixed identity and evidence. Passing this historical
input cannot replace the current-source feature checks or authorize a release.

`npm run pack:check` is another standalone build-first convenience: it builds
and checks npm's dry-run package inventory. After `verify`, that same package
check has already run. Each build writes `dist/lotus-next-manifest.json`, binding
package/version, exact source revision and dirty state, relative entrypoint,
and every regular resource's portable path, size and SHA-256. Its combined digest
is deterministic for one resource set. Consumers verify it before serving or
staging; a dirty source manifest is never a release artifact.

The following publication behavior is the existing historical contract, pending
the dependent release-producer cutover described in [delivery.md](delivery.md).
It is not the target release/main flow and does not authorize sending a new
feature-graph receipt to the old publisher.

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
