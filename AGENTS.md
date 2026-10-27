# Lotus Next agent guidance

Read [README.md](README.md) for the product boundary and
[delivery.md](docs/delivery.md) before changing CI, accepting a feature, cutting a
release, or publishing npm assets. The complete common
[delivery workflow](docs/delivery-workflow.md) and
[Actions audit](docs/ci-workflow-audit.md) are also stored in this repository.
Every agent uses their phase ownership and checkpoint procedure together with
the Lotus-specific commands below; check actual activation before a cut.

## Feature ownership

- Work in an isolated worktree on one bounded Issue branch. Feature PRs target
  `dev`. Run affected checks while iterating, then complete the affected full
  regression before dev admission. Fix Unit, browser E2E, real Bamboo and native
  Actor failures on the feature branch. Never leave test or fixture repairs for
  a release branch.
- Require the current-head/base `Feature acceptance` check. It joins both Node
  Unit lanes, all four browser shards, the real Bamboo round trip and packed
  local/HTTPS surfaces, and native Actor acceptance. Skipped, failed, cancelled
  or missing required jobs do not constitute acceptance.
- CI executes the actual PR merge snapshot. Preserve its base, head, snapshot,
  tree and run/attempt receipt. A feature head, tested merge snapshot, later dev
  commit and final release source are distinct identities. Do not rewrite
  `GITHUB_*` variables or relabel evidence to make them appear identical.
- Node 24 alone produces the verified `dist`; the four ordinary browser shards
  and real Bamboo E2E consume it. Node 22 runs Unit compatibility without Vite.
  Do not repeat browser suites for the test runner's Node version, run a second
  Vite build for real Bamboo, or rerun successful unrelated shards after one fails.
  Preserve the original failed attempt when reporting a rerun.

## Delivery activation

Issue #446 implements the feature gate under the unified Zenith #399 contract.
This checkout also stages the original npm producer (#455). It is not release
acceptance or main activation: complete feature evidence and the reviewed main
controller/bootstrap (#456) remain prerequisites. Historical v28/v29 publisher
definitions and the fixed 2026.10.12 recovery retain their original identities;
their tests read the frozen legacy fixture. Never submit a new feature receipt
to the old publisher or change an existing tag to make it fit the new producer.

The read-only source foundation in scripts/frozen-dev-source.mjs (#454) is
separate from publisher activation. It verifies the original eleven feature
jobs, their physical executions and logical outcomes, the real source and
acceptance ZIPs, and every resource in the original Node24 dist. It preserves
actual tested M, accepted dev S and trusted main controller C separately.
Missing or expired successful original artifacts stop admission. A successful
source proof cannot reserve a version, build, pack, publish or promote main.
The current red #450 run cannot authorize a cut; do not manufacture a green
receipt or replace a missing artifact with a new build. Review any producer
closure change explicitly before accepting it.

The staged publisher runs only by trusted-main `workflow_dispatch`. Its CLI is
`node scripts/release-npm-lifecycle.mjs <phase>`; actual `GITHUB_JOB` must match
`reserve`/prepare, `select|install|build|pack|restore`/build, or `finalize`/finalize.
Select before both lock installations, stamping, Vite or pack. Only C helpers
and C dependencies verify S data; install each trust root's locked dependencies
separately with scripts disabled. S builds once and packs once with prepack
disabled. Unit/browser/real Bamboo/native Actor suites belong to feature CI.
Only finalize receives npm/OIDC authority and publishes the retained original
tgz with scripts disabled. Every remote write re-enters the real Source verifier.

Rerun failed jobs in the same original run/controller. Complete explicit skipped
Build/Pack/Upload records allow a first build after known pre-build failure;
successful physical outputs always select restore. Started, missing or unknown
work, missing successful originals, or a different run stop instead of compiling
again. Preserve the original RED. The raw Actions ZIP is copied to the reserved
Release without repacking; 90-day Actions retention and surviving official
metadata bound recovery. A Release asset or completion JSON never grants Main
authority. Do not dispatch, bootstrap or change protection from this staged slice.

After the dependent cutover, only a fully accepted dev cut may become a frozen
release. Release work builds/packages/publishes the formal artifact once; it
does not run Unit or E2E. A runtime fix returns to a feature branch, tested dev
admission and a new cut. Main retains stable code and immutable tag/Release
manifest/provenance plus promotion PR/merge references. Main push/promotion
events perform no tests, compilation, package rebuild or publication. A trusted
release `workflow_dispatch` may execute the main-ref controller to build the
frozen release source once; controller ref and product phase are distinct.
Do not mutate the release head or add a
post-build JSON commit. Source manifests may keep `0.0.0`; temporary publication
stamps the actual build's version and source identity.

Use the existing protected review and release authorization. Do not change
branch protections, publication credentials or Environment scope as an
implementation shortcut. This feature slice does not authorize publication.

## Read-only Main foundation staged by #456 Phase A

`scripts/published-npm-admission.mjs` verifies completed publication with public
read ports. It independently authenticates the official C run/check suite,
executed workflow and complete helper/lock closure, latest successful jobs and
original physical executions, the unique finalizer frame, original raw Actions
ZIP and retained assets, tgz bytes and registry/provenance fields. It invokes
the real Source454 verifier. Main never imports the publisher's privileged
factory, spoofs `GITHUB_*`, installs npm dependencies or builds/tests/packages.
The shared registry comparator remains data-only and explicitly does not claim
cryptographic signature verification.

Promotion requires actual S ancestry and every S product blob/mode/gitlink,
plus the whole currently trusted Base control closure as ordinary blobs. Exact
S passes only if it already has those same controls. Preserve old physical
frame identities on copied-success reruns and retain earlier failed npm jobs;
a later successful finalizer may attest exact registry readback without
rewriting their outcomes. Download/comment counters are not identity.

The accepted release registry is empty by default. There is no CLI, Main YAML,
required-check/protection change, bootstrap, publication or hosted admission in
this phase. A future trusted-Base loader must supply the complete reviewed
control closure, including its own entrypoint, and authenticate real original
release evidence. Missing/expired Source artifacts or missing official original
metadata stop; never replace them with compilation. Run only the new focused
`published-npm-admission.test.mjs` cases while developing this data boundary.

## Validation and scope

Use `npm run verify` and the built browser suites against the output it
produced. Record exact source, commands, outcomes and remaining limitations in
the PR. Source-policy fixtures are not real-runtime or publication evidence.
Keep one acceptance slice within 4–8 hours and fewer than roughly 15 core files;
split independent lifecycle, recovery or persistence work before extending it.
