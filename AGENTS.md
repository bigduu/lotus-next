# Lotus Next agent guidance

Read [README.md](README.md) for the product boundary, [delivery.md](docs/delivery.md),
the shared [delivery workflow](docs/delivery-workflow.md), and the
[Actions audit](docs/ci-workflow-audit.md) before changing CI or releasing.
The shared migration table is a historical snapshot; check live workflows.

## Feature ownership

- Work in an isolated worktree on one bounded Issue branch. Feature PRs target
  `dev`. Run affected checks while iterating, then complete the affected full
  regression before dev admission. Fix Unit, browser E2E, real Bamboo and native
  Actor failures on the feature branch. Never leave test or fixture repairs for
  a release branch.
- Require the current-head/base `Feature acceptance` check. It joins the Node 22
  Unit lane, Node 24 artifact checks, all four browser shards, the real Bamboo round trip and packed
  local/HTTPS surfaces, and native Actor acceptance. Skipped, failed, cancelled
  or missing required jobs do not constitute acceptance.
- CI executes the actual PR merge snapshot. Preserve its base, head, snapshot,
  tree and run/attempt receipt. A feature head, tested merge snapshot, later dev
  commit and final release source are distinct identities. Do not rewrite
  `GITHUB_*` variables or relabel evidence to make them appear identical.
- Node 22 runs Unit once. Node 24 alone produces the verified `dist`; the four
  ordinary browser shards and real Bamboo E2E consume it.
  Do not repeat browser suites for the test runner's Node version, run a second
  Vite build for real Bamboo, or rerun successful unrelated shards after one fails.
  Preserve the original failed attempt when reporting a rerun.

## Delivery activation

Issue #446 implements the feature gate under the unified Zenith #399 contract.
Its dependent single-artifact release producer is not implemented by this slice.
The trusted read-only Main admission bootstrap is installed, but a real release
still needs the dependent producer. The current publisher recognizes historical candidate
receipts and retains its existing real-runtime gate. Do not describe the new
release/main flow as active or submit a new feature-graph receipt to that old
publisher. Preserve the separately owned frontend 2026.10.28 request (#445),
existing tags and original receipts.

The `verifyDevAcceptance` API in `scripts/release-source.mjs` checks an actual
Dev feature run and its tested merge tree as data. It does not fetch evidence,
freeze a release, allocate a version, build, pack, publish or replace the
historical publisher. A later reviewed producer must supply the original GitHub
evidence and independently prove the frozen ref and protected Dev ancestry.

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

## Validation and scope

Use `npm run verify` and the built browser suites against the output it
produced. Record exact source, commands, outcomes and remaining limitations in
the PR. Source-policy fixtures are not real-runtime or publication evidence.
Keep one acceptance slice within 4–8 hours and fewer than roughly 15 core files;
split independent lifecycle, recovery or persistence work before extending it.
