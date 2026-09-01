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

Vite listens on port `9563` and proxies `/v1`, `/api`, and `/v2` to Bamboo on port `9562`.

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
npm run type-check
npm run lint
npm run test:run
npm run build
npm run pack:check
```

`npm run pack:check` rebuilds the app, asks npm for the exact dry-run tarball manifest, and rejects anything outside `dist/` plus npm's required package metadata. The package remains at version `0.0.0`; this repository intentionally has no publish or release workflow yet.

The initial bundle-size baseline is recorded in [`docs/bundle-baseline.md`](docs/bundle-baseline.md). It is an observation gate, not a size-budget change.
