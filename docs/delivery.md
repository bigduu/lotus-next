# Lotus Next delivery

This repository follows the unified Zenith #399 delivery contract. Feature
acceptance is active on protected Dev. The trusted Main admission bootstrap is
installed; the single-artifact release producer is still a dependent change.
Main remains the default branch and current publication controller.

| Phase | Responsibility | Acceptance |
| --- | --- | --- |
| Feature PR to dev | Unit and all affected E2E, including real Bamboo and native Actor; fix failures here | Current-head/base `Feature acceptance` and its source receipt |
| Accepted dev cut | Preserve the actual tested snapshot and prove the admitted dev tree matches it | Frozen source identity; no moving-tip substitution |
| Frozen release, after cutover | Temporarily stamp the version, build/package/publish one formal artifact | Exact source/version, tag, manifest, hashes and registry readback; no Unit/E2E |
| Main push/promotion, after cutover | Promote stable code and retain immutable release references | Promotion PR/merge, tag and Release manifest/provenance; no tests, compilation or publication |

The last two rows are the target contract. The existing `publish-npm.yml` and
`release-source.mjs` remain unchanged for historical candidates during this
feature slice. Their real-runtime publication gate must not be removed or
bypassed piecemeal. The old source parser deliberately rejects the new feature
workflow graph until its dependent producer/admission change is ready. Do not
claim a release cutover from green feature CI alone. Coordinate outstanding
#445/frontend28 with its current owner; do not retarget or replace its frozen
tag, source or receipt.

The read-only `verifyDevAcceptance` foundation recognizes the complete Dev
feature graph separately from the historical publication parser. Given the
original PR, run, jobs, receipt and commit metadata, it checks their identities,
required results, pre-merge timing, parents and tree. It performs no API reads,
build, pack, publication or branch mutation on its own. The pending release
producer must obtain the original evidence, check the frozen ref and protected
Dev ancestry, and call this proof before activating a new publication path.

## Complete tests before dev

Feature PRs target `dev`. `ci.yml` has no main-push or release trigger. It checks
out the actual PR merge snapshot consistently in every source test job:

1. `Feature Source` verifies the event's canonical repository and dev base, the
   actual Git merge parents, checkout SHA and clean tree. It preserves PR base
   and head, tested snapshot/tree, workflow identity and run/attempt in the
   `feature-source` Actions artifact.
2. Node 22 runs Unit once. Node 24 runs type, lint, architecture, build and
   package checks and produces the one canonical test artifact without rerunning Unit.
   Four browser shards consume that artifact once across the complete original
   desktop/tablet/phone inventory. `build` owns TypeScript compilation; `verify` does
   not invoke `type-check` again before the same build. Standalone `type-check`
   remains available while iterating, and a compiler failure still fails CI.
3. Real Bamboo runs on every feature PR after all browser shards pass. It
   downloads the same verified Node 24 artifact instead of rebuilding it. The
   pinned published Bamboo executable and its same-source, compatibility-checked
   browser host drive the original round trip, packed loopback and HTTPS/WSS
   surfaces. CI records the source identities and the host file hash. These
   use isolated data and deterministic
   providers, not the user's live Bamboo instance. Install OS dependencies and
   the Playwright FFmpeg recorder while using the pinned verification browser;
   do not download a second, unused Chromium distribution.
4. CI calls `actor-native.yml` once as a reusable workflow. The existing base,
   observer, subscription and gap controls remain intact. It no longer has an
   independent PR trigger that would duplicate the same run. Its initial base
   and restored positive control use a verified pristine copy of the canonical
   artifact. Only the two changed frontend negative-control inputs are rebuilt;
   the two distinct backend fixture variants retain their own compilation.
5. `Feature acceptance` always collects all required results and validates the
   original source receipt. All gates must succeed. Its successful
   `feature-acceptance` artifact retains the actual tested source and gate
   results; it is not a publication receipt.

Dev protection requires `Feature acceptance`. Do not admit a feature while its
required evidence is missing or failed.

For a failed shard, rerun that job and its dependencies. Other successful
shards and the original same-run source receipt remain reusable. Source
receipts from another source/run or a future attempt are rejected. Keep the
first failure in the report instead of replacing it with the retry result.

## Preserve source identity

Let `B` be the feature PR base, `F` its head and `M` the actual merge snapshot
executed by CI. The receipt requires the real parents `B,F`, records `M` and its
tree, and never substitutes `F` for `M`. A later accepted dev commit `D` must
have its own normal-admission proof and the exact tested tree before a release
cut. This feature slice records the inputs needed for that later verifier; it
does not implement or claim the future `D` admission proof.

The formal artifact must identify the commit actually built from the frozen
release. A later main merge is separate promotion evidence. Equal source trees
do not make different commit IDs or artifacts interchangeable. Never spoof
`GITHUB_SHA`, `GITHUB_REF` or the event name to reuse the manual browser adapter.
The PR adapter verifies the real event and Git parents explicitly.

Unit/E2E test builds at source version `0.0.0`, Node compatibility lanes and
controlled negative variants are distinct test inputs. The formal versioned
release build is a separate input and occurs once after feature acceptance.
The future release producer performs static package/version/source checks and
publishes that exact tgz; no runtime test or repair is deferred to release.

## Immutable release references

After the dependent cutover, keep the frozen release head equal to the accepted
dev cut. A discovered runtime defect returns to a feature branch and new dev
acceptance, then a new cut. Do not fast-forward an existing cut to an untested
repair. Keep the release version in immutable tag and Release
manifest/provenance records with promotion PR and main merge references; do not
write a post-build JSON commit or change the source identity inside a package.

Keep publication on the existing trusted default-branch controller. Feature CI
has no npm credentials or publication authority. This slice neither changes
Environment/secret scope nor dispatches production publication.
The release workflow may be dispatched on its trusted main ref while building
the frozen release source once. That is release-phase work controlled by main;
it does not authorize builds or publication on main push/promotion events.
