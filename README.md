# lotus-next

Ground-up rebuild of the [Lotus](https://github.com/bigduu/Lotus) web frontend for the bamboo agent runtime — React 19 + TypeScript + Vite + **Tailwind v4 + shadcn-style components** (radix primitives, hand-written; no antd), designed responsive from the start so one codebase serves desktop and mobile.

> **Status:** feature parity with legacy lotus except i18n (UI is currently zh-CN only; locale resources exist but are unwired). Production still ships legacy lotus; this app runs against the same backend and is developed in parallel.

## Quick start

Requires a running bamboo server on `127.0.0.1:9562` (e.g. `bamboo serve`).

```bash
npm ci
npm run dev     # vite on :9563, /v1 /api /v2 proxied to 127.0.0.1:9562 (same-origin, shared sessions)
```

`npm run build` → `tsc -b && vite build`; `npm run lint` → oxlint.

## Feature surface

- **Chat**: v2 WebSocket streaming (`/v2/stream`, msgpack opt-in, no SSE fallback — a connection-down banner surfaces outages), live tool/task/budget timeline, sub-agent tracking, markdown + syntax highlighting + mermaid, image attachments, question / child-approval dialogs, plan-mode banner, dual interactive split panes, PDF/Markdown export.
- **Sessions**: date-grouped sidebar, multi-device live reconcile, pending-question rehydration on open, per-session drafts.
- **Settings** (14 tabs): provider instances with **vendor presets** (DeepSeek / 智谱 GLM / Z.ai / MiniMax / 通义千问 DashScope / Kimi, incl. Anthropic-protocol variants — see `src/lib/providerPresets.ts`), Copilot device-code auth, MCP, skills, permissions + bypass, schedules, notification channels (desktop/ntfy/bark), keyword masking, prompts, workflows, clusters + health, env vars, metrics dashboard (summary / by-model / daily / forward endpoints + requests / sync-mismatch / memory trend), experience mode (简洁/高级), VDI graphics-safe mode.

## Conventions

- UI strings are hardcoded zh-CN for now (i18n wiring is the one open parity gap).
- Secrets follow the mask round-trip contract: settings GET returns `****...****`; forms never prefill the placeholder; an empty key field means "keep the stored key".
- Path aliases mirror legacy lotus (`@shared @services @components @app`) so logic files port verbatim.
