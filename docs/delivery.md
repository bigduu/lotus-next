# Lotus Next delivery

The complete shared [delivery-flow/v1](delivery-workflow.md) and
[Actions audit](ci-workflow-audit.md) are local files copied from Zenith
`28b6e0e`. This guide supplies the Lotus commands and runtime map. A new agent
continues from the same branch/checkpoint and original evidence; it does not
repeat successful work merely because ownership changed.

This repository follows the unified Zenith #399 delivery contract. This checkout
contains feature acceptance (#446), the read-only source foundation (#454), the
staged single-original npm producer (#455) and read-only Main proof (#456 Phase
A). It does not establish accepted
feature evidence or activate main admission/bootstrap (#456). Main remains the
default branch and trusted publication controller.

| Phase | Responsibility | Acceptance |
| --- | --- | --- |
| Feature PR to dev | Unit and all affected E2E, including real Bamboo and native Actor; fix failures here | Current-head/base `Feature acceptance` and its source receipt |
| Accepted dev cut | Preserve the actual tested snapshot and prove the admitted dev tree matches it | Frozen source identity; no moving-tip substitution |
| Frozen release, after cutover | Temporarily stamp the version, build/package/publish one formal artifact | Exact source/version, tag, manifest, hashes and registry readback; no Unit/E2E |
| Main push/promotion, after cutover | Promote stable code and retain immutable release references | Promotion PR/merge, tag and Release manifest/provenance; no tests, compilation or publication |

The last two rows require coordinated activation. This branch stages a new
`publish-npm.yml`; immutable historical runs keep their original controller and
workflow. `scripts/fixtures/publish-npm-legacy-v29.yml`, old source helpers and
fixed recovery identities remain preserved. The old parser rejects the new
feature graph. Do not claim cutover from source/policy fixtures or green feature
CI alone. Preserve outstanding #445/frontend28, published v29 and the fixed
2026.10.12 tag, source, package bytes and receipts.

## Complete tests before dev

### Read-only frozen-source foundation

The frozen-dev-source.mjs helper (#454) prepares the dependent source proof. It
is not wired into the historical publisher. Its verifyAcceptedDev function
checks a confirmed normal dev merge against the original actual test merge and
all eleven real feature jobs, including complete Unit, browser, Real Bamboo and
native Actor steps. The admitFrozenDev wrapper additionally checks release/S
before and after. Do not create a release ref just to inspect an accepted source.

The verifier authenticates the official workflow/check suite and the finite
reviewed producer closure. GitHub may clear run PR associations after merge;
the independently confirmed PR, exact parents and original source ZIP establish
the link. A present association must match. Copied-success records retain the
original physical execution, ZIP ownership and latest logical outcome.
The original source/acceptance receipts and canonical Node24 dist must exist,
match their Actions digests and original execution times, and agree on the
actual M; every dist resource and the complete four-shard inventory are
verified without running candidate code or extracting the ZIP.

The trusted-main CLI is node scripts/frozen-dev-source.mjs admit <new-proof-path>,
with actual Actions controller identity, EXPECTED_SOURCE_SHA,
FEATURE_PULL_REQUEST, FEATURE_RUN_ID, FEATURE_RUN_ATTEMPT and a separate clean
SOURCE_ROOT. It writes a new local proof exclusively; it changes no Git ref or
remote state. Controller C, tested M, accepted/frozen S and a later main merge
remain distinct. Missing/expired originals, failed or skipped runtime, changed
refs, unconfirmed merges, unknown API state and unreviewed producers reject.

PR450 still lacks complete passing runtime evidence. This foundation does not
admit it or activate a release. Main admission/bootstrap remains #456. Keep the
failed historical v28 candidate, published v29 and fixed2026.10.12 recovery
unchanged.

### Staged original npm lifecycle (#455)

The trusted controller C verifies the frozen accepted S at `release/S` with the
original feature PR/run/attempt before every GitHub or npm write. C is the real
main-dispatch workflow/checkout SHA; M is the original tested merge snapshot.
They remain distinct. No phase rewrites `GITHUB_SHA`, `GITHUB_JOB` or other
Actions identity variables. The entrypoint is
`node scripts/release-npm-lifecycle.mjs <phase>`; workflow inputs supply one
explicit unused version, S and the original feature locators. `source_tree` is
derived by the real Source454 verifier, then checked again downstream.

| Job / CLI phase | Work and authority |
| --- | --- |
| prepare / `reserve` | Verify Source; reserve the explicit unused version with an annotated `lotus-next-vVERSION` tag and draft Release intent tied to this C/run and real numeric prepare job. GitHub contents write, Actions read; no npm token or OIDC. |
| build / `select` | Before installs or stamping, authenticate prior jobs and originals. A first execution selects build; a successful original selects restore. Read-only GitHub permissions. |
| build / `install`, `build`, `pack` | Install C and S from their own locks with scripts disabled. Stamp only disposable S package metadata, run S's explicit tsc/Vite build once, then `npm pack --ignore-scripts --json` once. C's `verify-package.mjs --source-root S --pack-result JSON` reuses that same pack JSON; full tar/resource hashes and filename/size/shasum/integrity must agree. No second dry-run pack or runtime suite. |
| build / `restore` | Verify and reuse the original physical job and raw outer Actions ZIP. No install, compiler, packer or replacement upload. |
| finalize / `finalize` | Check the latest builder whole-job success, retain the exact raw ZIP on the reserved Release, publish only its original tgz with `npm publish FILE --ignore-scripts --provenance --access public --registry=https://registry.npmjs.org`, and read back exact registry bytes and provenance fields. Only this job has OIDC and only this step receives the existing npm token. |

The checker uses C modules and C dependencies, never S's helper or dependency
tree. npm child environments explicitly omit inherited `NODE_OPTIONS`,
`NODE_PATH`, `GIT_*`, GitHub runtime/service tokens and unrelated credentials.
Publishing uses isolated user/global configs and a fixed registry. The real
Source guard runs immediately before every remote write; output JSON/ZIP is
data and cannot substitute for it. Source manifests remain committed at
`0.0.0`; temporary stamping adds no source commit or lockfile edit.

For infrastructure failure, rerun failed jobs in the same run and C. Only
complete explicit skipped Build/Pack/Upload records permit a first build after
known pre-build failure. Missing/unknown records or any actual failed build stop.
A later selector/pre-build failure can only restore an earlier successful
physical original; it never allows another build. Finalization still requires
the latest whole builder job to succeed. An uncertain publish permits exact
registry readback, never an automatic second publish. A previous explicitly
skipped publish step may proceed even when GitHub includes time placeholders.

Actions stores `original.zip` for 90 days. The Release asset
`lotus-next-original-VERSION.zip` is a byte-for-byte copy of the official outer
Actions ZIP, not a newly assembled archive. Missing successful originals or
missing official metadata stop recovery; surviving Release bytes alone do not
make deleted provenance reusable. A different dispatch cannot adopt the same
reservation. Preserve the original failure and return source repairs to feature
acceptance and a new cut/version rather than rebuilding an old successful one.

The immutable `lotus-next-publication-VERSION.json` and one bounded
`LOTUS_NPM_COMPLETION_V1` log frame carry the real C/run/finalizer and original
artifact/asset IDs and digests for #456. Both explicitly deny standalone
publication authority; public Main must authenticate their original official
execution. Registry DSSE field comparison is not standalone cryptographic
verification. This local slice has no actual release/registry acceptance,
Main gate, bootstrap, protection update or production dispatch.

### Read-only completed-publication and Main proof (#456 Phase A)

`scripts/published-npm-admission.mjs` provides `verifyPublishedNpm` and
`verifyPromotion` for a future trusted-Base caller. Inputs are exact frozen S,
version, original feature PR/run/attempt and release run; promotion additionally
binds the live Main PR, B, F and actual tested merge M. There is no CLI or write
port, and the default accepted-release registry is empty. No workflow or
protection is activated by importing the module.

The public reader authenticates the original release run's repository ID,
GitHub Actions check suite, executed main workflow C, normal C/Main ancestry and
the full reviewed C helper plus package/lock byte closure. It calls the real
Source454 verifier rather than a publisher factory that requires an active
dispatch. C, S, original feature M and Main promotion M remain separate facts;
the reader neither sets nor impersonates Actions environment variables.

Latest logical prepare/builder/finalizer jobs must succeed. Copied successes
retain the earliest complete physical execution and its original finalizer
log, ID and attempt. A real restore job is distinct from the original builder;
it must have skipped the compiler/packer/uploader and passed restore. A failed
pre-build job cannot hide actual compiler execution. The original Actions
artifact ID/digest/upload interval and retained raw ZIP must identify the same
physical build, original tgz and full resource manifest. Missing successful
metadata stops, even if Release bytes survive. Source454's own original feature
artifacts remain necessary too.

The exact annotated tag and Release intent bind S/version/C/run/original
prepare job. `Release.created_at` is commit metadata, not a prepare-job clock.
The unique successful physical finalizer's bounded completion frame binds the
original asset IDs and immutable completion asset. Registry bytes, checksums
and provenance fields must match that same tgz and actual C/run/publication
attempt. An earlier npm job may remain failed after uncertain publication;
only the independently authenticated successful finalizer proves its exact
registry readback. No old frame, job or failure is rewritten. The shared
`registryIdentity` comparator is moved verbatim into the original-output data
module; DSSE field comparison still reports `cryptographicVerification:false`.
Trusted C execution supplies the authority, not a self-described JSON archive.

Normal Main promotion preserves S's real ancestry and exact product leaves,
including symlink/executable modes and mode-160000 gitlinks. The candidate and
actual merge must contain the whole current trusted B control closure; all
declared B controls must be ordinary blobs. A complete S tree is acceptable only
when its controls already equal B. A same-tree copy without S ancestry, partial
control overlay or feature-only workflow that removes the Main gate rejects.
Fresh API checks ignore incidental download/comment counters while retaining
actual source/ref/ID/size/digest/body and original bytes.

Phase B still owns trusted-Base loading, the complete live entrypoint/control
list, source-only Main bootstrap and required checks, approved producer entries,
and positive/negative hosted admission. Phase A runs no npm install, tsc, Vite,
pack, Unit/browser runtime or publication. Its focused test command is
`node node_modules/vitest/vitest.mjs run scripts/published-npm-admission.test.mjs`;
tiny real Git/tar/ZIP fixtures and mock API/registry reads are not hosted
feature, release or Main acceptance. Preserve historical v28/v29 and fixed
2026.10.12 workflows, records and original evidence throughout activation.

### Executable feature ownership

Feature PRs target `dev`. `ci.yml` has no main-push or release trigger. It checks
out the actual PR merge snapshot consistently in every source test job:

1. `Feature Source` verifies the event's canonical repository and dev base, the
   actual Git merge parents, checkout SHA and clean tree. It preserves PR base
   and head, tested snapshot/tree, workflow identity and run/attempt in the
   `feature-source` Actions artifact.
2. Node 22 runs Unit compatibility. Node 24 runs Unit, type, lint, architecture,
   build and package checks and produces the one canonical test artifact.
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

The required branch check must be configured as `Feature acceptance` when dev
is activated. Creating/protecting dev and the release-controller bootstrap are
coordinated repository operations; editing YAML alone does not prove that
protection is active. Do not admit a feature while its required evidence is
missing or failed.

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
