# lotus-next

An experimental, ground-up rebuild of the [Lotus](https://github.com/bigduu/Lotus) web frontend for the Bamboo agent runtime. It uses React 19, TypeScript, Vite, Tailwind CSS v4, and hand-written components built on Radix primitives.

Lotus Next is the canonical forward-development target. Production cutover is tracked in [issue #11](https://github.com/bigduu/lotus-next/issues/11); the legacy Ant Design frontend remains only as the current production and rollback baseline while that migration is incomplete.

This repository documents the implementation that exists here today. It does not yet claim feature parity with Lotus or production readiness.

## Quick start

Run a Bamboo server on `127.0.0.1:9562`, then start the frontend:

```bash
npm ci
npm run dev
```

Vite listens on port `9563` and proxies `/api` and `/v2` to Bamboo on port
`9562`. Lotus Next sends every Bamboo-native REST request through the single
canonical `/api/v1` client; the historical `/v1` alias is deliberately not a
frontend proxy or fallback.

`VITE_BACKEND_BASE_URL` and newly persisted browser overrides accept a bare
HTTP(S) origin or exact `/api/v1`. New `/v1` input fails closed. During the
migration window, `src/runtime/browserRuntime.ts` alone may read the legacy
`copilot_backend_base_url` key, write and verify
`lotus_next_backend_endpoint_v1`, and only then delete the legacy value. That
reader is removed after every default consumer has run an artifact containing
the migration and its declared rollback window has ended.

## Implemented surface

- Chat over one shared `/v2/stream` WebSocket, using JSON by default and opt-in MessagePack negotiation.
- Streaming messages, reasoning, tools, tasks, budgets, sub-agents, Markdown, syntax highlighting, Mermaid, images, and approval or question dialogs.
- Session navigation, live account reconciliation, drafts, pending-question restoration, Markdown/PDF export, and a desktop split view with a second interactive chat pane.
- Responsive desktop and mobile layouts, light/dark/system themes, simple/advanced modes, and a graphics-safe mode for constrained environments.
- Fifteen settings tabs: General, Providers, MCP, Plugins, Skills, Permissions, Environment, Schedules, Notifications, Masking, Prompts, Workflows, Clusters, Metrics, and System.

## Internationalization

The i18next runtime currently registers six locales: `en-US`, `zh-CN`, `zh-TW`, `fr-FR`, `ja-JP`, and `hi-IN`. Locale resources load on demand, with `en-US` as the fallback.

Translation coverage is not complete: parts of the newer application shell and settings UI still contain hard-coded Chinese strings. The locale list therefore describes the implemented runtime and resources, not complete localization of every screen.

## Production gates

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

The real-runtime gate is intentionally separate from that deterministic matrix.
It builds a clean checkout of Bamboo revision
`49c6f3b8b4d0f72674f888aa3abcef7cd91cd372` into an isolated Docker image,
serves the production Lotus Next artifact from that Bamboo process, and drives
one complete chat turn through the visible desktop UI and a local deterministic
OpenAI-compatible provider. It requires the `auth.ws_hello_ack.v1` bootstrap
capability and records one ordered, bidirectional WebSocket timeline for both
the initial page and a fresh browser context, proving that exact `hello` is
acknowledged by exact `welcome` before any subscription is sent. The provider
shares Bamboo's test-owned network
namespace and listens only on that namespace's loopback interface; only Bamboo's
HTTP listener is published on a random host-loopback port. The provider writes
redacted observations atomically to a test-owned bind mount instead of exposing
its own API to the host.
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

`npm run pack:check` rebuilds the app, asks npm for the exact dry-run tarball manifest, and rejects anything outside `dist/` plus npm's required package metadata. The package remains at version `0.0.0`; this repository intentionally has no publish or release workflow yet.

The initial bundle-size baseline is recorded in [`docs/bundle-baseline.md`](docs/bundle-baseline.md). It is an observation gate, not a size-budget change.
