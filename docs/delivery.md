# Lotus Next delivery

This repository follows the unified Zenith #399 delivery contract. Feature
acceptance is active on protected Dev. The single-artifact release changes below
activate after their reviewed PR is accepted. Main remains the default branch;
the publisher uses protected Dev controls to build the frozen release source.
Check the installed workflows before a release; the new path has not yet been
exercised in production.

| Phase | Responsibility | Acceptance |
| --- | --- | --- |
| Feature PR to dev | Unit and all affected E2E, including real Bamboo and native Actor; fix failures here | Current-head/base `Feature acceptance` and its source receipt |
| Accepted dev cut | Preserve the actual tested snapshot and prove the admitted dev tree matches it | Frozen source identity; no moving-tip substitution |
| Frozen release, after cutover | Temporarily stamp the version, build/package/publish one formal artifact | Exact source/version, tag, manifest, hashes and registry readback; no Unit/E2E |
| Main push/promotion, after cutover | Promote stable code and retain immutable release references | Promotion PR/merge, tag and Release manifest/provenance; no tests, compilation or publication |

The release/main rows require complete feature acceptance and normal review.
The minimal publisher has one dispatch path. It trusts the actual normally merged
feature PR into protected Dev and verifies its immutable Git source; it does not
replay expiring historical CI or require an unreleased candidate/version record
to be committed to Main. The earlier Bamboo HTTPS failure in
#450 remains recorded; a fresh real-runtime result against the matching published
Bamboo source and binary is required before accepting the feature.

## Build and publish the original package once

1. After real feature acceptance, freeze `release/<accepted-Dev-SHA>`. Supply the
   version, `refs/tags/lotus-next-vVERSION`, source SHA and normally merged Dev PR
   to protected Dev; do not create that tag yourself. Controller and product
   source identities remain distinct.
2. Preflight checks the same-repository merged Dev PR, `merge_commit_sha=S`,
   exactly two Git parents matching the PR base/head, S's tree and protected
   Dev ancestry. S must contain the complete feature graph, all dependency edges
   and the real always-running aggregate. Unit, all four browser shards, real
   Bamboo and native Actor must have succeeded before the normal protected merge;
   release trusts that admission instead of independently proving historical
   job/step outcomes. For a new tag, require npm's explicit 404 before creating
   an annotated object binding version/source/original run/controller and
   atomically creating its formal ref. Read back the exact object before allowing
   build. Another run and an old tag without that owner are refused; an unknown
   create result permits only readback, never another speculative write.
   After every check, upload the publication run/attempt receipt;
   publish keeps the successful preflight's artifact ID across retries.
3. One build job stamps disposable package metadata, runs the final dist build
   once and creates one actual tgz with lifecycle scripts disabled. Static package
   checks use that pack's own manifest without another pack or compiler output.
   Retain the original tgz and pack identity for 90 days.
4. Publish downloads that same-run artifact, verifies its bytes and source,
   refreshes admission/tag reads, and uses the existing npm provenance and exact
   registry hash/resource readback. It installs/builds/packs no source and runs
   no Unit, browser or real-Bamboo suite. Main push/promotion runs no product suite.
5. Rerun failed publish jobs in that original run. Existing registry bytes
   must equal the retained tarball. A build retry requires complete same-run,
   same-controller metadata proving every earlier build/pack step was skipped;
   a whole skipped job requires its skipped conclusion and an empty steps array;
   started or missing evidence stops it. The owned formal tag rejects another
   run even when Actions history has disappeared. Same-run preflight may reuse
   its reservation without requiring npm vacancy again; publish still verifies
   any existing npm bytes against the retained original. Publication refresh is
   read-only and cannot recreate a missing tag. Missing successful originals
   stop recovery. A product repair returns through feature/dev/new cut.
   If a same-run preflight retry finds no tag, complete original metadata must
   prove that all earlier source/claim steps were skipped (or the whole preflight
   was skipped with no steps). A started, failed or unknown claim cannot authorize
   recreation of a missing tag.

Historical candidate rows, signed identities and the fixed published-version
verifier stay historical. The old reader remains available for those receipts,
not as a current publication fallback. No custom producer registry, allocator,
maintenance mode or separate publisher is introduced. Local policy fixtures do
not prove production publication; actual activation remains separately reviewed.

**Trust and retention:** protected Dev must retain strict `Feature acceptance`
from Actions app15368, administrator enforcement, no force pushes/deletion and
normal review/resolved-thread gates. The publisher checks the current branch
response for the required Actions check and administrator enforcement, as well as
protected Dev ancestry and source gate wiring; it does not prove that historical
protection settings or individual jobs were correct. The feature diagnostic
artifact still expires after 30 days; its absence no longer prevents releasing an
unchanged accepted Dev cut.
This replaces the historical-CI dependency discussed in [#471](https://github.com/bigduu/lotus-next/issues/471),
without claiming to authenticate deleted records or adding a trusted archive.

Publication recovery still depends on its original tarball and same-run Actions
records. The formal tag preserves the run that owns the version; it does not
preserve expired artifacts or prove a completed release. Never move/delete the
tag or dispatch that version in another run. Preserve originals and use separately
reviewed recovery when records expire; absent history is not permission to
rebuild. This revision does not extend the 90-day tarball retention. Main retains
its completed-publisher/npm checks and its one-formal-tag-per-source requirement.

### Required tag governance before activation

An administrator must separately configure and actually verify a repository
ruleset with target `tag`, enforcement `active`, include
`[refs/tags/lotus-next-v*]`, exclude `[]`, both update/deletion restrictions and
no bypass actors. Configure its numeric ID in the repository variable
`LOTUS_RELEASE_TAG_RULESET_ID`. No GitHub setting or real tag is created by this
code change. Do not enable publication until that live protection is verified.

Preflight alone adds `contents: write` for Git tag-object/ref creation. Build and
publish keep read-only repository access; npm/OIDC stays with publish. Both
preflight and publication refresh require the configured rule and exact scope;
missing, disabled, narrowed or excluded rules stop the job. GitHub's low-privilege
Get ruleset API does not guarantee `bypass_actors` visibility. Runtime records
whether the field was visible, rejects visible bypass actors, and never treats a
hidden field as empty. The administrator's no-bypass audit and ongoing governance
are explicit prerequisites, not facts established by runtime/local fixtures.
No long-lived admin token is introduced. Actual hosted token capability and
protection still need separate acceptance; permission errors stop before build.

This applies only to versions newly claimed after the rule and governance are
enabled. Before the first claim, an administrator must confirm the selected
version is new. If a pre-cutover failed build has lost both its formal tag and
Actions history, current tag/npm 404s cannot prove it never built. Do not reuse
that unknown historical version or claim this mechanism authenticates all past
versions. Existing old tags without an owner remain rejected.

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
3. Real Bamboo runs on every feature PR using the same verified Node 24 artifact
   instead of rebuilding it. An independently rerunnable chat/runtime job and
   local/HTTPS matrix each retain their own results. A separate producer packs
   the already-built test artifact once; both surfaces verify the original
   same-run ZIP digest, producer attempt, source receipt, tarball and identity.
   The matrix uses `fail-fast: false` so one failure does not cancel the other.
   The pinned published Bamboo executable and its same-source, compatibility-checked
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

Dev protection requires `Feature acceptance`. The staged feature workflow must
pass that real check before admission; editing YAML alone does not establish
acceptance. Do not admit a feature while its evidence is missing or failed.

For a failed shard or real-Bamboo surface, rerun failed jobs only. Other
successful jobs, the original same-run source receipt and test tarball remain
reusable. A producer may pack on a later attempt only when every prior pack is
positively known not to have started; missing, expired, damaged or unproven
original bytes stop recovery. Source receipts from another source/run or a
future attempt are rejected. Keep the first failure in the report instead of
replacing it with the retry result. The test tarball is not a formal release.

## Preserve source identity

Let `B` be the feature PR base, `F` its head and `M` the actual merge snapshot
executed by CI. The receipt requires the real parents `B,F`, records `M` and its
tree, and never substitutes `F` for `M`. A later accepted dev commit `D` must
have its own normal protected admission and the exact tested tree before a
release cut. The publisher verifies D's PR/parents/tree and trusts Dev's enforced
feature acceptance; it does not reconstruct M or an original run/attempt after
their evidence expires. The publication receipt records only the source and
publication identities actually checked.

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

The `Main Admission` check is a separate read-only `pull_request_target`
workflow for Main; dev PRs keep Feature acceptance. The reviewed Main bootstrap
and required check are installed; use Dev as the feature base while the complete
feature and publication controls await their own release and promotion. Main controls execute at the exact workflow
SHA; the PR is fetched as Git data and is never executed. Admission verifies
`release/<S>`, protected Dev ancestry, actual merge parents and unchanged S tree,
one annotated formal version tag, registry SHA-1/SHA-512 and the original complete
frontend manifest. Registry-served SLSA source binding must identify the actual
successful Dev publication run/controller. It does not claim Sigstore certificate
verification. Missing, ambiguous, moved or unpublished evidence fails closed;
there is no Main build, package, test or publish fallback. A positive promotion
still requires an actual completed publication and its evidence.

After the ready-event trigger update reaches Main, marking a draft promotion
ready starts a fresh read-only admission check. The currently installed Main
workflow lacks that trigger, so open the initial promotion ready for review;
do not change its frozen release head solely to retrigger admission.
