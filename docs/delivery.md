# Lotus Next delivery

This repository follows the unified Zenith #399 delivery contract. The feature
and single-artifact release changes below are staged until their reviewed PR is
accepted. Main remains the default branch; the target publisher uses protected
Dev controls to build the frozen release source. Check the installed workflows
before a release; the new path has not yet been exercised in production.

| Phase | Responsibility | Acceptance |
| --- | --- | --- |
| Feature PR to dev | Unit and all affected E2E, including real Bamboo and native Actor; fix failures here | Current-head/base `Feature acceptance` and its source receipt |
| Accepted dev cut | Preserve the actual tested snapshot and prove the admitted dev tree matches it | Frozen source identity; no moving-tip substitution |
| Frozen release, after cutover | Temporarily stamp the version, build/package/publish one formal artifact | Exact source/version, tag, manifest, hashes and registry readback; no Unit/E2E |
| Main push/promotion, after cutover | Promote stable code and retain immutable release references | Promotion PR/merge, tag and Release manifest/provenance; no tests, compilation or publication |

The release/main rows require complete feature acceptance and normal review.
The minimal publisher has one dispatch path. It reads the actual merged Dev PR,
original CI run and feature receipt; it does not require an unreleased candidate
or version record to be committed to Main. The known published Bamboo HTTPS
failure still blocks #450 and remains with its feature/input owner.

## Build and publish the original package once

1. After real feature acceptance, freeze `release/<accepted-Dev-SHA>` and reserve
   the existing annotated `lotus-next-vVERSION` tag at that exact Dev commit.
   Supply that version/tag/SHA plus the original Dev PR and CI run to the protected
   Dev-ref dispatch. Controller and product source identities remain distinct.
2. Preflight reads the actual PR/run/jobs, original Actions feature receipt and
   Git parents/tree. Unit, all four browser shards, real Bamboo and native Actor
   must have succeeded before Dev merge. After every check, upload the run/attempt
   receipt; publish keeps the successful preflight's artifact ID across retries.
3. One build job stamps disposable package metadata, runs the final dist build
   once and creates one actual tgz with lifecycle scripts disabled. Static package
   inventory may inspect a dry-run manifest; it produces no second tarball or
   compiler output. Retain the original tgz and pack identity for 90 days.
4. Publish downloads that same-run artifact, verifies its bytes and source,
   refreshes admission/tag reads, and uses the existing npm provenance and exact
   registry hash/resource readback. It installs/builds/packs no source and runs
   no Unit, browser or real-Bamboo suite. Main push/promotion runs no product suite.
5. Rerun failed publish jobs in that original run. Existing registry bytes
   must equal the retained tarball. A build retry requires complete same-run,
   same-controller metadata proving every earlier build/pack step was skipped;
   a whole skipped job requires its skipped conclusion and an empty steps array;
   started or missing evidence stops it. Another dispatch of the same version
   stops before compiling again; missing successful
   originals stop recovery. A product repair returns through feature/dev/new cut.

Historical candidate rows, signed identities and the fixed published-version
verifier stay historical. The old reader remains available for those receipts,
not as a current publication fallback. No custom producer registry, allocator,
maintenance mode or separate publisher is introduced. Local policy fixtures do
not prove production publication; actual activation remains separately reviewed.

## Complete tests before dev

Feature PRs target `dev`. `ci.yml` has no main-push or release trigger. It checks
out the actual PR merge snapshot consistently in every source test job:

1. `Feature Source` verifies the event's canonical repository and dev base, the
   actual Git merge parents, checkout SHA and clean tree. It preserves PR base
   and head, tested snapshot/tree, workflow identity and run/attempt in the
   `feature-source` Actions artifact.
2. Node 22 runs the Unit suite once. Node 24 runs lint, architecture, build and
   package checks and produces the canonical test artifact without rerunning Unit.
   Four browser shards consume that artifact once across the complete original
   desktop/tablet/phone inventory. `build` owns TypeScript compilation; `verify` does
   not invoke `type-check` again before the same build. Standalone `type-check`
   remains available while iterating, and a compiler failure still fails CI.
3. Real Bamboo runs on every feature PR after all browser shards pass. It
   downloads the same verified Node 24 artifact instead of rebuilding it. The
   pinned published Bamboo executable drives the original round trip, packed
   loopback and HTTPS/WSS surfaces. These use isolated data and deterministic
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

Dev protection requires `Feature acceptance`. The staged feature workflow must
pass that real check before admission; editing YAML alone does not establish
acceptance. Do not admit a feature while its evidence is missing or failed.

For a failed shard, rerun that job and its dependencies. Other successful
shards and the original same-run source receipt remain reusable. Source
receipts from another source/run or a future attempt are rejected. Keep the
first failure in the report instead of replacing it with the retry result.

## Preserve source identity

Let `B` be the feature PR base, `F` its head and `M` the actual merge snapshot
executed by CI. The receipt requires the real parents `B,F`, records `M` and its
tree, and never substitutes `F` for `M`. A later accepted dev commit `D` must
have its own normal-admission proof and the exact tested tree before a release
cut. The staged publisher verifies that proof from the original feature run.

The formal artifact must identify the commit actually built from the frozen
release. A later main merge is separate promotion evidence. Equal source trees
do not make different commit IDs or artifacts interchangeable. Never spoof
`GITHUB_SHA`, `GITHUB_REF` or the event name to reuse the manual browser adapter.
The PR adapter verifies the real event and Git parents explicitly.

Unit/E2E test builds at source version `0.0.0`, Node compatibility lanes and
controlled negative variants are distinct test inputs. The formal versioned
release build is a separate input and occurs once after feature acceptance.
The staged release producer performs static package/version/source checks and
publishes that exact tgz; no runtime test or repair is deferred to release.

## Immutable release references

After the dependent cutover, keep the frozen release head equal to the accepted
dev cut. A discovered runtime defect returns to a feature branch and new dev
acceptance, then a new cut. Do not fast-forward an existing cut to an untested
repair. Keep the release version in immutable tag and Release
manifest/provenance records with promotion PR and main merge references; do not
write a post-build JSON commit or change the source identity inside a package.

Keep publication on the protected Dev controller; build only frozen release S. Feature CI
has no npm credentials or publication authority. This slice neither changes
Environment/secret scope nor dispatches production publication.
The release workflow is dispatched on protected dev while building only the
frozen release source once. Dev C and product S remain distinct;
it does not authorize builds or publication on main push/promotion events.

## Main promotion gate

The staged `Main Admission` check is a separate read-only `pull_request_target`
workflow for Main; dev PRs keep the original Feature acceptance alone. Bootstrap
its reviewed workflow/helper controls into Main first and require its real check
in Main protection with an up-to-date base before activation. Main controls execute at the exact workflow
SHA; the PR is fetched as Git data and is never executed. Admission verifies
`release/<S>`, protected Dev ancestry, actual merge parents and unchanged S tree,
one annotated formal version tag, registry SHA-1/SHA-512 and the original complete
frontend manifest. Registry-served SLSA source binding must identify the actual
successful Dev publication run/controller. It does not claim Sigstore certificate
verification. Missing, ambiguous, moved or unpublished evidence fails closed;
there is no Main build, package, test or publish fallback. No positive promotion
or protection activation is established by these staged source changes.
