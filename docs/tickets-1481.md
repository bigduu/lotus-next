# Opt-in Supervisor ticket overview (#1481)

Based on `1131c275cb441694a41f996228d9f91473d920f5`, isolated from other Lotus
work. The canonical Supervisor scope and message/request capabilities are
negotiated with Bamboo. The normal composer remains the input surface; its
optional reference preserves thread/reply/correlation metadata. Mutation-off,
old-server and ordinary-session paths keep the existing chat behavior.

The overview displays all open question/approval cards, submitted evidence and
managed artifacts, plus closed/superseded history. Reads use fixed authoritative
snapshots and bounded changes; partial, lagged and disconnected views cannot
claim completeness or approve actions. Version fences reject old request,
generation, contract and scope state. Unknown decision ACKs retain the exact
operation. Only an ordinary question's definite revision conflict permits one
bounded refresh/rebase after exact binding is revalidated. Approvals never
auto-rebase or execute offline. Acknowledged chat with uncertain activation
retries activation only. Session storage retains payload hashes/IDs, no text,
images or credentials.

Validation: current complete unit suite 2048/2048 (123 files), type-check, lint,
architecture, build and package contents/budget passed. Initial post-attachment
dependency read failed in picomatch; an isolated offline npm reinstall repaired
the dependency tree. Package verification initially hit the default npm cache
write restriction, then exposed a 102-byte CSS budget excess. Use
`NPM_CONFIG_CACHE=/tmp/1481-npm-cache` for the authorized isolated cache.
Shared utility/inline layout styles now keep startup CSS at 105971 bytes under
the unchanged 106000-byte limit. The ordinary-chat JS budget also passes.

`e2e/ticket-runtime.spec.ts` with `playwright.tickets.config.ts` runs against
the actual Bamboo ignored `ticket_browser_fixture` test, serving this build.
Chromium and the Host cross-check passed with five native worker questions,
E/B/D/A/C answers, a mid-flow reload, exact A-only approval, material B steering
and stale request/button rejection. Browser 28.6s; Host 111.68s including wait.
The controlled provider fixture is separate from configured-model semantic
proposal evaluation. Workers remain submitted until explicit acceptance.

Reproduce: build, start the Bamboo fixture with `BAMBOO_TICKET_FIXTURE_STATIC_DIR`
and `BAMBOO_TICKET_FIXTURE_INFO`; wait for `TICKET_BROWSER_READY`; run
`LOTUS_TICKET_FIXTURE_INFO=<same JSON> npm exec --offline -- playwright test
--config=playwright.tickets.config.ts`. Screenshot/runtime reports are retained
at `../1481-evidence/p8-ui-fixture4*`. A final browser run will cover the finalized
bundle together with P9. Feature flags remain opt-in; no publishing is performed.
