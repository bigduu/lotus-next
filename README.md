# lotus-next

An experimental, ground-up rebuild of the [Lotus](https://github.com/bigduu/Lotus) web frontend for the Bamboo agent runtime. It uses React 19, TypeScript, Vite, Tailwind CSS v4, and hand-written components built on Radix primitives.

This repository documents the implementation that exists here today. It does not claim feature parity with Lotus or production readiness.

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

## Current engineering boundary

The repository currently defines two local verification commands:

```bash
npm run lint
npm run build
```

There is no automated test command, CI workflow, or release workflow in this repository yet. Those capabilities are not implied by this README.
