# Lotus Next agent guidance

Read [README.md](README.md) for the product boundary and
[delivery.md](docs/delivery.md), the shared [delivery workflow](docs/delivery-workflow.md)
and [Actions audit](docs/ci-workflow-audit.md) before changing CI, accepting a
feature, cutting a release, or publishing npm assets. The shared migration table
is a historical snapshot; check the local guide and live workflows for activation.

## Feature ownership

- Work in an isolated worktree on one bounded Issue branch. Feature PRs target
  `dev`. Run affected checks while iterating, then complete the affected full
  regression before dev admission. Fix Unit, browser E2E, real Bamboo and native
  Actor failures on the feature branch. Never leave test or fixture repairs for
  a release branch.
- Require the current-head/base `Feature acceptance` check. It joins the Node
  22 Unit lane, Node 24 artifact checks, all four browser shards, the real Bamboo
  round trip, one test-package producer, both packed local/HTTPS surfaces, and
  native Actor acceptance.
  Skipped, failed, cancelled or missing required jobs do not constitute acceptance.
- CI executes the actual PR merge snapshot. Preserve its base, head, snapshot,
  tree and run/attempt receipt. A feature head, tested merge snapshot, later dev
  commit and final release source are distinct identities. Do not rewrite
  `GITHUB_*` variables or relabel evidence to make them appear identical.
- Node 22 runs the Unit suite once. Node 24 runs the other verification checks
  and alone produces the verified `dist`; all browser shards and real Bamboo
  E2E consume it.
  The real Bamboo round trip, local surface and HTTPS surface are independently
  rerunnable; both surfaces use the original run-bound test tarball. Rerun failed
  jobs only and retain the first failure. Do not repack after a pack step starts:
  missing, expired or unverifiable original package evidence stops recovery.
  Do not repeat browser suites for the test runner's Node version, run a second
  Vite build for real Bamboo, or rerun successful unrelated shards after one fails.

## Delivery activation

Issue #446 owns complete feature acceptance. All fourteen selected jobs and required
runtime steps must succeed before Dev admission; the actual tested merge and
admitted Dev tree must match. The publisher trusts that normal protected Dev
admission. It checks the same-repository merged PR, S's actual parents matching
the PR base/head, S's tree, Dev ancestry and complete source gate wiring. It does
not independently replay historical CI or require expiring feature run/job/artifact records.
Dev must keep strict `Feature acceptance` from Actions app15368, enforced for
administrators, with force pushes and deletion disabled. Keep the real aggregate,
normal review and resolved-thread gates; a same-name success stub or skipped
owner is not acceptance. No candidate/version record on Main is required.
The earlier Bamboo HTTPS failure in #450 remains recorded. Require a fresh
real-runtime result against the matching published Bamboo source and binary;
a source fix alone does not establish that acceptance.

`publish-npm.yml` runs only from protected Dev controls; it never builds moving
dev. It has one dispatch path: preflight -> build/pack -> publish.
Freeze `release/<accepted-Dev-SHA>` and provide the version, formal tag name and
normally merged Dev PR. Do not pre-create the formal version tag. Preflight first
checks source admission and npm vacancy, then claims `lotus-next-vVERSION` with an
annotated object binding version/source/original run/controller. Only that run
may reuse the tag; another run or an old annotation without an owner stops.
Preflight uploads its run/attempt-bound receipt only after all checks; publish
uses that successful preflight's artifact ID on retries. Build stamps a disposable
checkout, builds dist once, packs once without lifecycle scripts and retains the
original tgz plus pack identity in standard Actions storage. Publish downloads
those exact bytes, checks them, refreshes Dev/source admission and the immutable
tag, then retains the existing npm provenance and registry readback checks.
The target path has no release Unit/E2E, second Vite build or producer registry;
Main does not run the publication controller after cutover.

Retry failed publication jobs in the original run using the retained tarball;
an already published version must match it exactly. A build retry is allowed only
when the same run/controller's complete metadata proves every prior attempt had
both build/pack steps skipped, or a wholly skipped job with an empty steps array.
Started or missing evidence stops rebuilding. A replacement dispatch for the
same claimed version stops even after the original Actions history expires.
If its tag is missing on a same-run retry, first claim is allowed only when every
earlier preflight/source step was positively unstarted; missing or started
evidence stops rather than recreating a potentially lost original tag.
Missing original output stops recovery. Historical candidate/receipt functions
and fixed published-version recovery keep their old identities and cannot admit
a new feature cut through the current CLI. The reviewed workflow becomes available
on protected Dev after admission. It does not itself authorize publication; full
feature acceptance and release authorization remain required.

Feature CI still records its actual snapshot and attempt for diagnostics, with
the existing 30-day artifact retention. Their expiry does not invalidate normal
protected Dev source admission. This trust boundary replaces the publisher's
historical-CI dependency discussed in #471; it is not durable authentication of
deleted CI records. Do not invent `testedSnapshot` or feature-attempt claims.
The original run's retry evidence and tarball remain time limited. Missing
metadata or output stops recovery; tag ownership never permits another build.
Do not delete or move a claimed version tag to release its reservation. Main
still checks the completed publisher and package; a reservation is not success.

Before enabling this path, an administrator must configure and actually verify
an active repository tag ruleset with include `[refs/tags/lotus-next-v*]`,
exclude `[]`, update/deletion restrictions and no bypass actors, then set
`LOTUS_RELEASE_TAG_RULESET_ID` as a repository variable. This change does not
create or activate that rule. Runtime checks the visible rule ID, target/scope,
enforcement and restrictions; Metadata read access does not guarantee visibility
of `bypass_actors`. Hidden actors are recorded as hidden, never interpreted as an
empty list. The no-bypass guarantee depends on the administrator's separately
verified configuration remaining in force. Only preflight gets `contents: write`;
build/publish retain read access, and only publish receives npm/OIDC authority.
Do not add an admin token or claim local tests prove live protection.
This protects versions first claimed after that governance is enabled. It cannot
reconstruct a pre-cutover failed build whose tag and Actions history were both
deleted. An administrator must establish that a selected new version is new;
present-day tag/npm 404s are not proof that an unknown historical version was
never built. Do not admit such a version or rewrite an old unowned tag.

After the dependent cutover, only a fully accepted dev cut may become a frozen
release. Release work builds/packages/publishes the formal artifact once; it
does not run Unit or E2E. A runtime fix returns to a feature branch, tested dev
admission and a new cut. Main retains stable code and immutable tag/Release
manifest/provenance plus promotion PR/merge references. Main push/promotion
events perform no tests, compilation, package rebuild or publication. A trusted
release `workflow_dispatch` executes the protected dev-ref controller to build the
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

## Read-only Main admission

After the reviewed control-only bootstrap into Main, `main-promotion.yml` runs
only on `pull_request_target` to Main and executes the exact Main workflow SHA.
It fetches PR Git objects as data; it never runs PR/package code. `Main Admission`
requires same-repository `release/<S>`, protected Dev ancestry, the actual B/S
merge with tree equal to S, an annotated formal tag and the original npm package,
manifest and completed Dev publisher evidence. The original dev Feature acceptance
workflow remains separate. Main protection must require this real check against the current base before
cutover; installing YAML alone is not enforcement or a positive promotion proof.
