# Browser CI shards

## Temporary dev protection bridge

Until #450 installs the complete feature contract, `Feature acceptance` runs
only for pull requests into `dev` and requires both existing `verify` and
`Browser acceptance` jobs to succeed. Failure, cancellation, skipped or missing
dependency outcomes fail this bridge. It adds no test skip or protection bypass.
The existing dual Node 22/24 Unit verification and all eight browser shards
remain unchanged. Real Bamboo remains an explicit manual check; it is not
automatically covered by this temporary aggregate, and native Actor acceptance
and exact PR merge-source receipts are not installed here.

This bridge produces no release receipt and cannot authorize publication under
the new release-source contract. The historical parser also rejects this
transitional graph. Historical publication tests retain the exact prior workflow
in `scripts/fixtures/ci-sharded-main-v1.yml`; #450 replaces the temporary bridge
and its tests with the complete feature/source admission rather than treating
this check name alone as full acceptance.

`ci.yml` retains Node 22 and 24 verification and runs four all-surface Playwright
shards per Node lane. Each shard keeps one worker, the existing retry/timeout
settings, and the desktop/tablet/phone projects. The three additional source
fixture suites still run once per Node lane, on shard 1. No test or skip policy
is changed.

After the verified build, `node scripts/browser-shards.mjs inventory` compares
the unsharded `--list` inventory with all four `--shard=N/4` inventories. Their
union must contain each original case exactly once. Each Node lane shares its
own built artifact and inventory with its shards; the source revision and clean
artifact identity are checked before execution.

`Browser acceptance` runs even if a dependency fails. It requires both Node
verification lanes and all eight browser jobs to succeed. Receipts must agree
on source, run, original inventory and per-shard cases. Missing, duplicate,
failed, cancelled, skipped-required, interrupted or mismatched results fail
closed. The conditional Real Bamboo job depends on verification and this
complete aggregate; its existing dispatch policy is unchanged.

## Diagnose and rerun one shard

Every browser job has a separate name and artifacts containing its Node, shard
and attempt. `playwright-report-node-N-shard-S-attempt-A` contains the original
HTML/JSON report, trace and failure attachments. `browser-receipt-*` contains the
small machine-readable outcome used by the aggregate.

Use GitHub's **Re-run job** on the failed shard, or the normal job endpoint:

```sh
gh api --method POST repos/bigduu/lotus-next/actions/jobs/JOB_ID/rerun
```

GitHub reruns the selected job and its dependent jobs. Successful unrelated
shards and their original receipts remain reusable in the same run. The
aggregate selects the latest attempt for each required shard, rejects duplicate
receipts for that attempt, and never replaces a newer failure with an older
success. Rerunning all jobs remains possible; intermediate build inputs are
replaced while outcome artifacts retain their attempt identities.

## Measure the result

The aggregate uploads `browser-summary.json` and writes per-Node browser wall
time, summed browser runner time, outcomes and shard durations to the run
summary. These timings cover the all-surface Playwright invocations. They do
not include queue time, setup or the additional fixture suites.

After a run completes, read its jobs (all pages, `filter=latest` for a normal
snapshot) and use their actual `started_at`/`completed_at` timestamps:

- End-to-end wall time is the span from the first required job start to the
  aggregate's completion. Report queue delay separately if included.
- Job runner minutes are the sum of all required job durations divided by 60;
  also report each job rounded up to a minute if estimating billable usage.
- When evaluating a rerun, preserve the original attempt's measurements and
  count newly executed jobs separately. A latest-job view alone omits replaced
  failed attempts from the total cost.

The baseline is [PR #428 run 40205151437](https://github.com/bigduu/lotus-next/actions/runs/40205151437):
Node 22 browser 29m42s / entire job 33m40s; Node 24 browser 33m59s / entire job
38m32s. Its inventory was 1,047 cases (349 on each surface), 243 existing skips
per Node, with one Node 22 flaky case. Four shards reduce serialization but add
setup and artifact transfer costs; use measured balance and runner minutes
before changing concurrency again.

## Publication evidence and historical sources

`scripts/release-source.mjs` loads the CI workflow from the immutable accepted
source SHA. The legacy graph requires its original Node 22/24 and Real Bamboo
jobs. The sharded graph additionally requires all eight exact shard jobs and
`Browser acceptance`, each completed successfully on the accepted source SHA.
The job list must be complete and contain exactly that graph, without duplicate
or unknown jobs. PR/main source admission retains the real runtime policy skip;
publication still runs its existing artifact compatibility gate.

Historical candidate receipts keep their bytes, hashes and original workflow
graph. An old unsharded run cannot validate a source containing the new graph.
This change neither edits the frozen Bodhi 2026.10.26 release source nor restarts
its acceptance or publication runs.
