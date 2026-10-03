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

Validation: current complete unit suite 2049/2049 (123 files), type-check, lint,
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
at `../1481-evidence/p8-ui-fixture4*`. Feature flags remain opt-in; no publishing
is performed.

P9 final verification adds a regression for two definite CAS conflicts followed
by explicit ordinary-question resubmission. Decision errors remain visible
through successful read refresh, preserving the draft; only a new decision
attempt clears them. The browser waits for each native Assignment's stopped
process before answering the next Work, and permits at most three explicit user
clicks after definite question conflicts. It never retries approval or uncertain
ACK automatically.

Final Chromium 1/1 passed in 45.5s; actual Bamboo Host cross-check 1/1 passed in
94.87s including browser wait. The current bundle passes five exact answers,
generation-2 submissions, A-only approval, stale B rejection and hidden internal
decision wakes after reload. Browser/Runtime reports and inspected screenshots
are at `../1481-evidence/p9-ui-final4*`; logs are
`/tmp/1481-p9-lotus-browser4.log` and `/tmp/1481-p9-browser-fixture4.log`.
Earlier failures and an exec-server-interrupted attempt are retained separately.
The complete final unit/type/lint/architecture/build/package run is recorded in
`/tmp/1481-p9-lotus-final-verify.log`. Startup JS is 1422851 raw / 432706 gzip
bytes; original resource budgets are unchanged. Controlled provider UI tests do
not substitute for real-model semantic evaluation or arbitrary coding sandbox
and remote lease-expiry acceptance, which remain separate Bamboo gates.

## Independent review follow-up

The compatible local Codex CLI completed a read-only review of `5895e9d`
against `1131c275`, finding seven regressions introduced by this feature.
All seven are addressed: opt-in native fixtures are excluded from ordinary
Playwright discovery; semantic messages can be sent during a running Supervisor
without legacy queue controls; initial and retried activation recheck the Root
fence; authentication rejection of a replay preserves an earlier unknown Human
receipt; incomplete snapshots disable decisions; exact decision receipts persist
before delivery and survive navigation/reload/rejected replays; reference actions
are hidden where semantic ingress is unavailable.

Focused regressions: 38/38. Full Vitest: 2054/2054 in 123 files. Type/lint,
architecture, build and package checks passed. Logs:
`/tmp/1481-lotus-review-fixes-tests.log`,
`/tmp/1481-lotus-reviewed-full-verify.log`,
`/tmp/1481-lotus-reviewed-package.log`. Package verification used a task-local
npm cache after the default cache was denied by the filesystem sandbox.
The changed head still requires a fresh independent review and built browser
acceptance; the earlier browser evidence belongs to `5895e9d`.

## Second independent review corrections

The explicit read-only review of `54b22c7` completed with four findings.
An uncertain Human receipt now keeps the composer on semantic ingress while
scope negotiation reloads, preventing a legacy-send or queue fallback. New
receipts retain only minimal thread/reply/correlation references and a versioned
canonical payload hash, so an exact retry can restore a closed request's
reference. Changed content or references fail closed. A storage failure blocks
the POST before delivery; malformed saved receipts also remain visible and
cannot silently select a fresh message ID. Legacy receipt hashes remain readable;
references absent from that earlier schema cannot be inferred.

Polling renegotiates capabilities and flags even when the Ticket sequence is
unchanged. A writable partial snapshot allows ordinary semantic input while
keeping precise card decisions disabled. It never claims that the unseen scope
is complete or grants approval from reference metadata.

Validation of the seven changed source/test files: focused 92/92 and complete
Vitest 2058/2058 in 123 files; type-check, lint and architecture pass. Logs and
exit markers are in `../1481-evidence/1481-lotus-tmp-*`. Documents-based test
workers failed before executing cases; the detached `/tmp` acceptance worktree
uses byte-verified source overlays and the exact existing lockfile, with 477
packages installed offline from the task cache. No dependency versions changed.
An initial new storage-mock/rerender assertion failure and a fresh browser-type
check failure are preserved, then corrected and revalidated. Current clean
build/package and real Host/browser results remain pending at this checkpoint.

## Third independent review corrections (MacBook, six P2 findings)

The completed read-only review of `02ffa593` found six introduced races and
recovery gaps. Scope negotiation now finishes before the composer may select
legacy delivery. All panes share a per-session ingress admission lock; cleanup
checks the exact saved Human ID. An acknowledged message retains a durable
activation-only phase until execution is confirmed, including reload and Root
mode fencing. This receipt contains no message or attachment content. Legacy
receipt versions remain readable.

An ordinary answer's single conflict rebase checks the refreshed connection,
complete coverage, write authority and original scope binding before a second
POST. HTTP 410 change gaps reload a fixed snapshot. A single inspector budget
rejection preserves the negotiated scope and other Work views with explicit
incomplete coverage; it cannot enable card decisions or hide a different error.

The byte-verified eight-file source overlay passed focused 107/107, fresh
type-check and architecture checks. A redundant React dependency initially
failed lint, then its removal passed lint. Logs and earlier outcomes remain in
`../1481-evidence/1481-macbook-lotus-six-p2-*`. Full regression, clean built
browser acceptance and fresh review of this changed head are subsequent gates;
no earlier-head result is represented as their completion. Dependency versions
and bundle budgets are unchanged. No remote operation is authorized.
