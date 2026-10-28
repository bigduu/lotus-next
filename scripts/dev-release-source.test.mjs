import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { acceptanceJobNames, devFeatureJobNames, verifyDevAcceptance, verifyProtectedDevMerge,
  versionTagOwner, verifyVersionTagRuleset, readOwnedVersionTag, claimVersionTag, assertUnclaimedTagRetry } from "./release-source.mjs"

const clone = value => JSON.parse(JSON.stringify(value))
const tagRule = () => ({ id: 7, source_type: "Repository", source: "bigduu/lotus-next", target: "tag", enforcement: "active",
  conditions: { ref_name: { include: ["refs/tags/lotus-next-v*"], exclude: [] } }, rules: [{ type: "update" }, { type: "deletion" }] })

describe("durable formal version ownership", () => {
  const owner = versionTagOwner({ LOTUS_NEXT_RELEASE_VERSION: "2026.10.30", EXPECTED_SOURCE_SHA_INPUT: "d".repeat(40),
    GITHUB_RUN_ID: "99", GITHUB_WORKFLOW_SHA: "c".repeat(40) })
  const fixture = ({ existing, failure, vacant = true } = {}) => {
    const objects = new Map(), calls = [], objectSha = "a".repeat(40), refName = "refs/tags/lotus-next-v2026.10.30"
    let ref = null, refreshes = 0
    const object = (data, value = objectSha) => ({ sha: value, tag: "lotus-next-v2026.10.30", message: JSON.stringify(data), object: { type: "commit", sha: data.sourceSha } })
    if (existing) { objects.set(objectSha, object(existing)); ref = { ref: refName, object: { type: "tag", sha: objectSha } } }
    const read = route => {
      calls.push("GET " + route)
      if (route === "git/ref/tags/lotus-next-v2026.10.30") return clone(ref)
      if (!route.startsWith("git/tags/") || !objects.has(route.slice(9))) throw Error("Unknown tag object")
      return clone(objects.get(route.slice(9)))
    }
    const operations = { read,
      refresh: () => { calls.push("refresh"); if (++refreshes === 2 && failure === "protection drift") throw Error("Protection changed") },
      registryVacant: async () => { calls.push("npm vacancy"); if (!vacant) throw Error("Registry not proven vacant") },
      create: (route, payload) => {
        calls.push("POST " + route)
        if (route === "git/tags") {
          expect(payload).toEqual({ tag: "lotus-next-v2026.10.30", message: JSON.stringify(owner), object: owner.sourceSha, type: "commit" })
          const created = object(owner); objects.set(objectSha, created)
          if (failure === "object response lost") throw Error("Unknown object response")
          return clone(created)
        }
        expect(route).toBe("git/refs"); expect(payload).toEqual({ ref: refName, sha: objectSha })
        if (failure === "foreign race") {
          const foreign = "b".repeat(40); objects.set(foreign, object({ ...owner, runId: "100" }, foreign))
          ref = { ref: refName, object: { type: "tag", sha: foreign } }; throw Error("Create conflict")
        }
        if (failure === "missing ref") throw Error("Unknown ref response")
        ref = { ref: refName, object: { type: "tag", sha: objectSha } }
        if (failure === "ref response lost") throw Error("Unknown ref response")
        return clone(ref)
      },
    }
    return { operations, calls, read, objects, ref: () => ref, objectSha }
  }
  it("claims only after registry vacancy and fresh protection, then verifies the exact atomic ref", async () => {
    const x = fixture()
    expect(await claimVersionTag(owner, x.operations)).toBe(x.objectSha)
    expect(x.calls).toEqual(["GET git/ref/tags/lotus-next-v2026.10.30", "npm vacancy", "refresh", "POST git/tags", "refresh",
      "POST git/refs", "GET git/ref/tags/lotus-next-v2026.10.30", "GET git/tags/" + x.objectSha])
  })
  it("reuses its own run without Actions history or another registry vacancy/create request", async () => {
    const x = fixture({ existing: owner, vacant: false })
    expect(await claimVersionTag(owner, x.operations)).toBe(x.objectSha)
    expect(x.calls.some(call => call.startsWith("POST ") || call === "npm vacancy")).toBe(false)
  })
  it("does not replace an already observed tag even with the same owner fields", async () => {
    const x = fixture({ existing: owner })
    await expect(claimVersionTag(owner, { ...x.operations, expectedTag: "b".repeat(40) })).rejects.toThrow(/changed during admission/)
    expect(x.calls.some(call => call.startsWith("POST ") || call === "npm vacancy")).toBe(false)
  })
  it("allows a first claim on retry only when every prior source step was positively unstarted", () => {
    const env = { GITHUB_RUN_ID: "99", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: owner.workflowSha }
    const previous = { total_count: 1, jobs: [{ name: "Validate publication request", run_id: 99, run_attempt: 1,
      head_sha: owner.workflowSha, status: "completed", conclusion: "failure", steps: [
        { name: "Resolve the reviewed immutable release candidate", status: "completed", conclusion: "skipped" },
      ] }] }
    expect(() => assertUnclaimedTagRetry(env, () => clone(previous))).not.toThrow()
    for (const change of [
      d => { d.jobs[0].steps[0].conclusion = "success" }, d => { d.jobs[0].steps[0].conclusion = "failure" },
      d => { d.jobs[0].steps[0].status = "in_progress" }, d => { d.jobs[0].steps = [] },
      d => { d.jobs[0].head_sha = owner.sourceSha }, d => { d.total_count++ },
    ]) { const altered = clone(previous); change(altered); expect(() => assertUnclaimedTagRetry(env, () => altered)).toThrow() }
    previous.jobs[0].conclusion = "skipped"; previous.jobs[0].steps = []
    expect(() => assertUnclaimedTagRetry(env, () => clone(previous))).not.toThrow()
    expect(() => assertUnclaimedTagRetry(env, () => { throw Error("No retained evidence") })).toThrow()
  })
  it.each(["runId", "workflowSha", "sourceSha", "version"])("refuses another %s before a write or registry query", async field => {
    const value = field === "runId" ? "100" : field === "version" ? "2026.10.31" : "f".repeat(40)
    const x = fixture({ existing: { ...owner, [field]: value } })
    await expect(claimVersionTag(owner, x.operations)).rejects.toThrow()
    expect(x.calls.some(call => call.startsWith("POST ") || call === "npm vacancy")).toBe(false)
  })
  it("never adopts an unowned historical annotation or lightweight tag", () => {
    for (const mutate of [x => { x.objects.get(x.objectSha).message = "Reserved formal version" },
      x => { x.ref().object.type = "commit" }]) {
      const x = fixture({ existing: owner }); mutate(x)
      expect(() => readOwnedVersionTag(owner, x.read)).toThrow()
    }
  })
  it("does not reserve a published version or unknown registry state", async () => {
    const x = fixture({ vacant: false })
    await expect(claimVersionTag(owner, x.operations)).rejects.toThrow(/Registry not proven vacant/)
    expect(x.calls.some(call => call.startsWith("POST "))).toBe(false)
  })
  it.each(["object response lost", "missing ref", "foreign race", "protection drift"])("stops %s without retrying a write", async failure => {
    const x = fixture({ failure })
    await expect(claimVersionTag(owner, x.operations)).rejects.toThrow()
    expect(x.calls.filter(call => call === "POST git/tags")).toHaveLength(1)
    expect(x.calls.filter(call => call === "POST git/refs").length).toBeLessThanOrEqual(1)
  })
  it("recovers an unknown successful ref creation only by reading the owned immutable object", async () => {
    const x = fixture({ failure: "ref response lost" })
    expect(await claimVersionTag(owner, x.operations)).toBe(x.objectSha)
    expect(x.calls.filter(call => call.startsWith("POST "))).toHaveLength(2)
  })
  it("fails unknown reads rather than treating them as a missing tag", async () => {
    const x = fixture(); x.operations.read = () => { throw Error("GitHub unavailable") }
    await expect(claimVersionTag(owner, x.operations)).rejects.toThrow(/GitHub unavailable/)
    expect(x.calls).toEqual([])
  })
  it("checks exact active tag protection without pretending hidden bypass actors are empty", () => {
    expect(verifyVersionTagRuleset(tagRule(), 7)).toEqual({ rulesetId: 7, bypassActorsVisible: false })
    expect(verifyVersionTagRuleset({ ...tagRule(), bypass_actors: [] }, 7)).toEqual({ rulesetId: 7, bypassActorsVisible: true })
    expect(verifyVersionTagRuleset({ ...tagRule(), rules: [{ type: "update", parameters: { update_allows_fetch_and_merge: false } }, { type: "deletion" }] }, 7)).toBeTruthy()
  })
  it.each([
    r => { r.enforcement = "evaluate" }, r => { r.target = "branch" }, r => { r.id = 8 }, r => { r.source = "other/repository" },
    r => { r.conditions.ref_name.exclude = ["refs/tags/lotus-next-v2026.10.*"] },
    r => { r.conditions.ref_name.include = ["refs/tags/lotus-next-v2026.10.*"] },
    r => { delete r.conditions.ref_name.exclude }, r => { r.rules.pop() }, r => { r.rules.push({ type: "creation" }) },
    r => { r.rules[0].parameters = { update_allows_fetch_and_merge: true } },
    r => { r.bypass_actors = [{ actor_type: "Integration", actor_id: 1, bypass_mode: "always" }] },
  ])("rejects incomplete or incompatible tag protection #%#", mutate => {
    const r = tagRule(); mutate(r); expect(() => verifyVersionTagRuleset(r, 7)).toThrow()
  })
})

describe("historical explicit pre-merge Dev feature evidence", () => {
  const workflow = readFileSync("scripts/fixtures/ci-dev-feature-v1.yml", "utf8")
  const fixture = () => {
    const source = "d".repeat(40), head = "f".repeat(40), base = "b".repeat(40), snapshot = "a".repeat(40), tree = "c".repeat(40)
    const pr = { number: 450, state: "closed", merged: true, base: { ref: "dev", repo: { full_name: "bigduu/lotus-next" } },
      head: { sha: head, repo: { full_name: "bigduu/lotus-next" } }, merge_commit_sha: source, merged_at: "2026-10-27T12:00:00Z" }
    const run = { id: 10, run_attempt: 1, workflow_id: 1, path: ".github/workflows/ci.yml", event: "pull_request", head_sha: head,
      repository: { full_name: "bigduu/lotus-next" }, head_repository: { full_name: "bigduu/lotus-next" }, status: "completed", conclusion: "success" }
    const steps = { "Node 22": ["Verify Node 22 Unit compatibility"], "Node 24": ["Verify architecture, build, and package contents"],
      "Real Bamboo / Node 24": ["Verify a real chat round trip with the pinned published Bamboo", "Verify the current source artifact on local and secure browser surfaces"],
      "Native Actor acceptance / Native Actor / Node 24": ["Verify three negative controls and restored real Actor proof"] }
    for (const n of [1, 2, 3, 4]) steps[`Browser / Node 24 / shard ${n} of 4`] = ["Verify the all-surface browser shard"]
    const jobs = { total_count: 11, jobs: devFeatureJobNames(workflow).map(name => ({ name, run_id: 10, run_attempt: 1, head_sha: head, status: "completed", conclusion: "success",
      completed_at: "2026-10-27T11:00:00Z", steps: (steps[name] || []).map(name => ({ name, status: "completed", conclusion: "success" })) })) }
    const receipt = { schemaVersion: 1, kind: "lotus-feature-acceptance/v1", source: { repository: "bigduu/lotus-next", pullRequest: 450,
      baseRef: "dev", headSha: head, baseSha: base, runId: "10", sourceRunAttempt: 1, testedSnapshot: snapshot, testedTree: tree },
      gates: { source: "success", verify: "success", browser: "success", realBamboo: "success", nativeActor: "success" }, acceptanceRunAttempt: 1 }
    const merged = { sha: source, parents: [{ sha: base }, { sha: head }], tree: { sha: tree } }
    const tested = { ...clone(merged), sha: snapshot }
    return { source, pr, run, jobs, receipt, merged, tested }
  }
  const verify = x => verifyDevAcceptance(x.source, x.pr, x.run, x.jobs, x.receipt, x.merged, x.tested, 1, workflow)
  it("accepts the actual tested M and normally merged D without any Main candidate registration", () => {
    const x = fixture()
    expect(verify(x)).toEqual({ sourceTree: x.merged.tree.sha, testedSnapshot: x.tested.sha, featureRunAttempt: 1 })
  })
  it.each(["failure", "cancelled", "skipped"])("rejects every incomplete feature owner: %s", state => {
    for (let i = 0; i < 11; i++) { const x = fixture(); x.jobs.jobs[i].conclusion = state; expect(() => verify(x)).toThrow() }
  })
  it("rejects skipped runtime steps even if the enclosing job is green", () => {
    const x = fixture(); x.jobs.jobs.find(j => j.name === "Real Bamboo / Node 24").steps[1].conclusion = "skipped"
    expect(() => verify(x)).toThrow()
  })
  it("accepts successful earlier-attempt jobs when the final acceptance receipt matches its own attempt", () => {
    const x = fixture(); x.run.run_attempt = 2; x.receipt.acceptanceRunAttempt = 2
    x.jobs.jobs.find(job => job.name === "Feature acceptance").run_attempt = 2
    expect(() => verify(x)).not.toThrow()
  })
  it.each([
    ["foreign source", x => { x.pr.head.repo.full_name = "other/repo" }],
    ["Main instead of Dev", x => { x.pr.base.ref = "main" }],
    ["unmerged source", x => { x.pr.merged = false }],
    ["foreign run", x => { x.run.workflow_id = 2 }],
    ["manual diagnostic", x => { x.run.event = "workflow_dispatch" }],
    ["wrong run source", x => { x.run.head_sha = x.source }],
    ["job from another run", x => { x.jobs.jobs[0].run_id = 999 }],
    ["future job attempt", x => { x.jobs.jobs[0].run_attempt = 2 }],
    ["missing job attempt", x => { delete x.jobs.jobs[0].run_attempt }],
    ["fractional job attempt", x => { x.jobs.jobs[0].run_attempt = 0.5 }],
    ["acceptance job from another attempt", x => { x.run.run_attempt = 2; x.receipt.acceptanceRunAttempt = 2 }],
    ["fractional source attempt", x => { x.receipt.source.sourceRunAttempt = 0.5 }],
    ["fractional acceptance attempt", x => { x.receipt.acceptanceRunAttempt = 0.5 }],
    ["invalid tested snapshot", x => { x.receipt.source.testedSnapshot = "invalid" }],
    ["missing job", x => { x.jobs.jobs.pop() }],
    ["wrong tested tree", x => { x.tested.tree.sha = "e".repeat(40) }],
    ["rewritten Dev parents", x => { x.merged.parents.reverse() }],
    ["post-merge tests", x => { x.jobs.jobs[0].completed_at = "2026-10-27T13:00:00Z" }],
    ["partial runtime receipt", x => { x.receipt.gates.realBamboo = "skipped" }],
  ])("rejects %s", (_name, change) => { const x = fixture(); change(x); expect(() => verify(x)).toThrow() })
})

describe("publication trusts normal protected Dev admission", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  const fixture = () => ({ source: "d".repeat(40),
    pr: { number: 450, state: "closed", merged: true, merge_commit_sha: "d".repeat(40),
      base: { ref: "dev", sha: "b".repeat(40), repo: { full_name: "bigduu/lotus-next" } },
      head: { sha: "f".repeat(40), repo: { full_name: "bigduu/lotus-next" } } },
    merged: { sha: "d".repeat(40), parents: [{ sha: "b".repeat(40) }, { sha: "f".repeat(40) }], tree: { sha: "c".repeat(40) } } })
  const verify = (x, ci = workflow) => verifyProtectedDevMerge(x.source, x.pr, x.merged, ci)
  it("accepts a normal merged Dev source without claiming a historical CI snapshot or attempt", () => {
    expect(verify(fixture())).toEqual({ sourceTree: "c".repeat(40) })
  })
  it("also accepts the unchanged complete historical Dev graph", () => {
    const historical = readFileSync("scripts/fixtures/ci-dev-feature-v1.yml", "utf8")
    expect(verify(fixture(), historical)).toEqual({ sourceTree: "c".repeat(40) })
  })
  it.each([
    ["unmerged PR", x => { x.pr.merged = false }], ["open PR", x => { x.pr.state = "open" }],
    ["Main PR", x => { x.pr.base.ref = "main" }], ["foreign base", x => { x.pr.base.repo.full_name = "other/lotus-next" }],
    ["foreign head", x => { x.pr.head.repo.full_name = "other/lotus-next" }],
    ["different admitted source", x => { x.pr.merge_commit_sha = "e".repeat(40) }],
    ["different Git object", x => { x.merged.sha = "e".repeat(40) }],
    ["invalid admitted base", x => { x.pr.base.sha = "dev" }],
    ["different admitted base", x => { x.pr.base.sha = "e".repeat(40) }],
    ["squash merge", x => { x.merged.parents.pop() }],
    ["octopus merge", x => { x.merged.parents.push({ sha: "e".repeat(40) }) }],
    ["indirect feature head", x => { x.merged.parents[1].sha = "e".repeat(40) }],
    ["reversed parents", x => { x.merged.parents.reverse() }],
    ["invalid parent", x => { x.merged.parents[0].sha = "dev" }],
    ["duplicate parents", x => { x.merged.parents[0].sha = x.pr.head.sha }],
    ["invalid tree", x => { x.merged.tree.sha = "main" }],
  ])("rejects %s", (_name, mutate) => { const x = fixture(); mutate(x); expect(() => verify(x)).toThrow() })
  it.each([
    ["old source graph", () => readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8")],
    ["temporary bridge", () => readFileSync("scripts/fixtures/ci-dev-bridge-v1.yml", "utf8")],
    ["Main push trigger", s => s.replace("on:\n", "on:\n  push:\n    branches: [main]\n")],
    ["conditional owner", s => s.replace("  real-bamboo:\n", "  real-bamboo:\n    if: false\n")],
    ["ignored failure", s => s.replace("  verify:\n", "  verify:\n    continue-on-error: true\n")],
    ["missing aggregate always", s => s.replace("    name: Feature acceptance\n    if: ${{ always() }}", "    name: Feature acceptance\n    if: success()")],
    ["missing runtime need", s => s.replace("[source, verify, browser-summary, real-bamboo, real-bamboo-package, real-bamboo-surface, native-actor]", "[source, verify, browser-summary, native-actor]")],
    ["missing browser need", s => s.replace("needs: [verify, browser]", "needs: [verify]")],
    ["missing package owner", s => s.replace("[source, verify, browser-summary, real-bamboo, real-bamboo-package, real-bamboo-surface, native-actor]", "[source, verify, browser-summary, real-bamboo, real-bamboo-surface, native-actor]")],
    ["forged package result", s => s.replace("REAL_BAMBOO_PACKAGE_RESULT: ${{ needs.real-bamboo-package.result }}", "REAL_BAMBOO_PACKAGE_RESULT: success")],
    ["forged surface result", s => s.replace("REAL_BAMBOO_SURFACE_RESULT: ${{ needs.real-bamboo-surface.result }}", "REAL_BAMBOO_SURFACE_RESULT: success")],
    ["fake package guard", s => s.replace("run: node scripts/feature-bamboo-package.mjs guard", "run: echo success")],
    ["fake local surface", s => s.replace("feature-bamboo-package.mjs surface ${{ matrix.mode }}", "feature-bamboo-package.mjs surface local")],
    ["unbound package download", s => s.replace("FEATURE_PACKAGE_ARTIFACT_ID: ${{ needs.real-bamboo-package.outputs.artifact_id }}", "FEATURE_PACKAGE_ARTIFACT_ID: 42")],
    ["missing HTTPS matrix mode", s => s.replace("          - remote\n", "")],
    ["extra surface matrix mode", s => s.replace("          - remote\n", "          - remote\n          - fake\n")],
    ["matrix cancels sibling", s => s.replace("      fail-fast: false\n      matrix:\n        mode:", "      fail-fast: true\n      matrix:\n        mode:")],
    ["fake aggregate", s => s.replace("run: node scripts/feature-acceptance.mjs summarize", "run: echo success")],
    ["skipped aggregate step", s => s.replace("        run: node scripts/feature-acceptance.mjs summarize", "        if: false\n        run: node scripts/feature-acceptance.mjs summarize")],
    ["forged runtime result", s => s.replace("REAL_BAMBOO_RESULT: ${{ needs.real-bamboo.result }}", "REAL_BAMBOO_RESULT: success")],
    ["quoted conditional override", s => s.replace("    name: Real Bamboo / Node 24", "    'if': false\n    name: Real Bamboo / Node 24")],
    ["verify matrix excludes the Unit lane", s => s.replace("      matrix:\n        node:\n", "      matrix:\n        exclude:\n          - node: 22\n        node:\n")],
    ["verify matrix adds an included lane", s => s.replace("      matrix:\n        node:\n", "      matrix:\n        include:\n          - node: 22\n        node:\n")],
    ["browser matrix excludes a shard", s => s.replace("        shard:\n", "        exclude:\n          - node: 24\n            shard: 1\n        shard:\n")],
    ["browser matrix includes an extra shard", s => s.replace("        shard:\n", "        include:\n          - node: 24\n            shard: 5\n        shard:\n")],
    ["verify matrix has a quoted exclusion", s => s.replace("      matrix:\n        node:\n", "      matrix:\n        'exclude':\n          - node: 22\n        node:\n")],
    ["browser matrix repeats the shard key", s => s.replace("        shard:\n", "        shard:\n          - 1\n        shard:\n")],
  ])("rejects incomplete gate wiring: %s", (_name, mutate) => {
    expect(() => verify(fixture(), mutate(workflow))).toThrow()
  })
})

describe("split Dev feature receipt", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  const fixture = () => {
    const source = "d".repeat(40), head = "f".repeat(40), base = "b".repeat(40), snapshot = "a".repeat(40), tree = "c".repeat(40)
    const pr = { number: 482, state: "closed", merged: true, base: { ref: "dev", repo: { full_name: "bigduu/lotus-next" } },
      head: { sha: head, repo: { full_name: "bigduu/lotus-next" } }, merge_commit_sha: source, merged_at: "2026-10-28T12:00:00Z" }
    const run = { id: 10, run_attempt: 2, workflow_id: 1, path: ".github/workflows/ci.yml", event: "pull_request", head_sha: head,
      repository: { full_name: "bigduu/lotus-next" }, head_repository: { full_name: "bigduu/lotus-next" }, status: "completed", conclusion: "success" }
    const steps = { "Node 22": ["Verify Node 22 Unit compatibility"], "Node 24": ["Verify architecture, build, and package contents"],
      "Real Bamboo / Node 24": ["Verify a real chat round trip with the pinned published Bamboo"],
      "Prepare real Bamboo test package": ["Pack the exact-source test artifact", "Upload the original test package"],
      "Real Bamboo local / Node 24": ["Verify the current source artifact on the selected browser surface"],
      "Real Bamboo remote / Node 24": ["Verify the current source artifact on the selected browser surface"],
      "Native Actor acceptance / Native Actor / Node 24": ["Verify three negative controls and restored real Actor proof"] }
    for (const n of [1, 2, 3, 4]) steps[`Browser / Node 24 / shard ${n} of 4`] = ["Verify the all-surface browser shard"]
    const names = devFeatureJobNames(workflow)
    const jobs = { total_count: names.length, jobs: names.map(name => ({ name, run_id: 10,
      run_attempt: name === "Feature acceptance" || name === "Real Bamboo remote / Node 24" ? 2 : 1,
      head_sha: head, status: "completed", conclusion: "success", completed_at: "2026-10-28T11:00:00Z",
      steps: (steps[name] || []).map(name => ({ name, status: "completed", conclusion: "success" })) })) }
    const receipt = { schemaVersion: 2, kind: "lotus-feature-acceptance/v2", source: { repository: "bigduu/lotus-next", pullRequest: 482,
      baseRef: "dev", headSha: head, baseSha: base, runId: "10", sourceRunAttempt: 1, testedSnapshot: snapshot, testedTree: tree },
      gates: { source: "success", verify: "success", browser: "success", realBamboo: "success", realBambooPackage: "success",
        realBambooSurface: "success", nativeActor: "success" }, acceptanceRunAttempt: 2 }
    const merged = { sha: source, parents: [{ sha: base }, { sha: head }], tree: { sha: tree } }
    const tested = { ...clone(merged), sha: snapshot }
    return { source, pr, run, jobs, receipt, merged, tested }
  }
  const verify = x => verifyDevAcceptance(x.source, x.pr, x.run, x.jobs, x.receipt, x.merged, x.tested, 1, workflow)
  it("accepts earlier successful siblings and the original package with a later HTTPS result", () => {
    expect(() => verify(fixture())).not.toThrow()
  })
  it.each(["Prepare real Bamboo test package", "Real Bamboo / Node 24", "Real Bamboo local / Node 24", "Real Bamboo remote / Node 24"])(
    "rejects an incomplete split owner: %s", name => {
      const x = fixture(); x.jobs.jobs.find(job => job.name === name).conclusion = "skipped"
      expect(() => verify(x)).toThrow()
    })
  it("rejects an old receipt masquerading as a split acceptance", () => {
    const x = fixture(); x.receipt.kind = "lotus-feature-acceptance/v1"; x.receipt.schemaVersion = 1
    expect(() => verify(x)).toThrow()
  })
})

describe("protected Dev publication CLI", () => {
  const runSource = (change) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "lotus-dev-merge-trust-"))), repo = join(root, "repo"), bin = join(root, "bin")
    mkdirSync(repo); mkdirSync(bin); mkdirSync(join(repo, "scripts")); mkdirSync(join(repo, ".github", "workflows"), { recursive: true })
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim()
    try {
      git("init", "--quiet", "--initial-branch=dev"); git("config", "user.name", "Dev source policy")
      git("config", "user.email", "dev-source@example.invalid")
      writeFileSync(join(repo, "scripts/release-source.mjs"), readFileSync(resolve("scripts/release-source.mjs")))
      writeFileSync(join(repo, ".github/workflows/ci.yml"), readFileSync(".github/workflows/ci.yml"))
      writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "@bigduu/lotus-next", version: "0.0.0" }))
      git("add", "."); git("commit", "--quiet", "-m", "Dev base")
      const base = git("rev-parse", "HEAD")
      git("checkout", "--quiet", "-b", "feature"); writeFileSync(join(repo, "feature.txt"), "feature\n")
      git("add", "."); git("commit", "--quiet", "-m", "Feature head")
      const head = git("rev-parse", "HEAD")
      git("checkout", "--quiet", "dev"); git("merge", "--quiet", "--no-ff", "feature", "-m", "Normal Dev merge")
      const source = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}")
      git("commit", "--quiet", "--allow-empty", "-m", "Later trusted controller")
      const controller = git("rev-parse", "HEAD")
      const owner = versionTagOwner({ LOTUS_NEXT_RELEASE_VERSION: "2026.10.30", EXPECTED_SOURCE_SHA_INPUT: source,
        GITHUB_RUN_ID: "99", GITHUB_WORKFLOW_SHA: controller })
      const reserve = ["new tag", "lost ref response", "registry published", "registry unknown"].includes(change)
      if (!reserve) git("tag", "-a", "lotus-next-v2026.10.30", source, "-m", JSON.stringify(owner))
      git("remote", "add", "origin", repo)
      const pr = { number: 450, state: "closed", merged: true, merged_at: "2020-01-01T00:00:00Z", merge_commit_sha: source,
        base: { ref: "dev", sha: base, repo: { full_name: "bigduu/lotus-next" } }, head: { sha: head, repo: { full_name: "bigduu/lotus-next" } } }
      const object = reserve ? "a".repeat(40) : git("rev-parse", "refs/tags/lotus-next-v2026.10.30")
      const routes = { "rulesets/7": tagRule(),
        "git/ref/tags/lotus-next-v2026.10.30": { ref: "refs/tags/lotus-next-v2026.10.30", object: { type: "tag", sha: object } },
        [`git/tags/${object}`]: { sha: object, tag: "lotus-next-v2026.10.30", object: { type: "commit", sha: source }, message: JSON.stringify(owner) },
        "pulls/450": pr, [`git/commits/${source}`]: { sha: source, parents: [{ sha: base }, { sha: head }], tree: { sha: tree } },
        "branches/dev": { name: "dev", protected: true, protection: { enabled: true, required_status_checks: {
          enforcement_level: "everyone", contexts: ["Feature acceptance"], checks: [{ context: "Feature acceptance", app_id: 15368 }],
        } }, commit: { sha: controller } },
        [`compare/${controller}...${controller}`]: { merge_base_commit: { sha: controller }, status: "identical" },
        [`compare/${source}...${controller}`]: { merge_base_commit: { sha: source }, status: "ahead" },
        [`git/ref/heads/release/${source}`]: { object: { sha: source } } }
      if (change === "unprotected Dev") routes["branches/dev"].protected = false
      if (change === "disabled Dev protection") routes["branches/dev"].protection.enabled = false
      if (change === "missing required feature check") routes["branches/dev"].protection.required_status_checks.contexts = []
      if (change === "wrong feature check app") routes["branches/dev"].protection.required_status_checks.checks[0].app_id = 1
      if (change === "administrators exempted") routes["branches/dev"].protection.required_status_checks.enforcement_level = "non_admins"
      if (change === "unaccepted controller") routes[`compare/${controller}...${controller}`].merge_base_commit.sha = base
      if (change === "non-ancestor source") routes[`compare/${source}...${controller}`].merge_base_commit.sha = base
      if (change === "moved release ref") routes[`git/ref/heads/release/${source}`].object.sha = controller
      if (change === "forged Git parents") routes[`git/commits/${source}`].parents[0].sha = controller
      if (change === "moved tag") routes[`git/tags/${object}`].object.sha = controller
      writeFileSync(join(bin, "gh"), `#!${process.execPath}\nconst fs = require('node:fs');
const {spawnSync}=require('node:child_process');
const route = process.argv[3]?.replace('repos/bigduu/lotus-next/', '');
const method=process.argv.includes('--method')?process.argv[process.argv.indexOf('--method')+1]:'GET';
fs.appendFileSync(process.env.SOURCE_API_LOG, (method==='GET'?'':method+' ')+route + '\\n');
const routes = JSON.parse(process.env.SOURCE_API_ROUTES);
const git=(args,input)=>{const r=spawnSync('git',args,{encoding:'utf8',input});if(r.status!==0)process.exit(2);return r.stdout.trim()};
if(process.env.SOURCE_TAG_RESERVE==='true'){
  const name='lotus-next-v2026.10.30', ref='refs/tags/'+name;
  const tagged=object=>{const raw=git(['cat-file','-p',object]);const at=raw.indexOf('\\n\\n');return {sha:object,tag:name,message:raw.slice(at+2),object:{type:'commit',sha:/^object ([0-9a-f]{40})/m.exec(raw)[1]}}};
  if(method==='POST'){
    const value=JSON.parse(fs.readFileSync(0,'utf8'));
    if(route==='git/tags'){
      const object=git(['mktag'],'object '+value.object+'\\ntype commit\\ntag '+value.tag+'\\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\\n\\n'+value.message+'\\n');
      process.stdout.write(JSON.stringify(tagged(object)));process.exit(0);
    }
    if(route!=='git/refs'||value.ref!==ref)process.exit(2);
    git(['update-ref',ref,value.sha,'0'.repeat(40)]);
    if(process.env.SOURCE_LOST_REF==='true'){process.stdout.write('unknown');process.exit(1)}
    process.stdout.write(JSON.stringify({ref,object:{type:'tag',sha:value.sha}}));process.exit(0);
  }
  if(route==='git/ref/tags/'+name){
    const r=spawnSync('git',['rev-parse','--verify','--quiet',ref],{encoding:'utf8'});
    if(r.status!==0){process.stdout.write(JSON.stringify({status:'404'}));process.exit(1)}
    process.stdout.write(JSON.stringify({ref,object:{type:'tag',sha:r.stdout.trim()}}));process.exit(0);
  }
  if(route?.startsWith('git/tags/')){process.stdout.write(JSON.stringify(tagged(route.slice(9))));process.exit(0)}
}
if (process.argv[2] !== 'api' || !Object.hasOwn(routes, route)) { console.error('No retained feature CI record: ' + route); process.exit(2); }
process.stdout.write(JSON.stringify(routes[route]));\n`, { mode: 0o755 })
      writeFileSync(join(root, "registry.mjs"), `import {appendFileSync} from 'node:fs';
globalThis.fetch=async(url,options)=>{if(url!=='https://registry.npmjs.org/@bigduu%2flotus-next/2026.10.30'||options.redirect!=='error')throw Error('Unexpected registry request');appendFileSync(process.env.SOURCE_API_LOG,'npm vacancy\\n');return {status:Number(process.env.SOURCE_REGISTRY_STATUS),body:{cancel:async()=>{}}}};\n`)
      const output = join(root, "receipt.json"), calls = join(root, "api.log")
      const result = spawnSync(process.execPath, ["--import", join(root, "registry.mjs"), join(repo, "scripts/release-source.mjs"), ...(reserve ? ["reserve"] : [])], { cwd: repo, encoding: "utf8", timeout: 10000,
        env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_REPOSITORY: "bigduu/lotus-next",
          GITHUB_REF: "refs/heads/dev", GITHUB_REF_PROTECTED: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_SHA: controller, GITHUB_WORKFLOW_SHA: controller, EXPECTED_WORKFLOW_SHA: controller,
          GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/publish-npm.yml@refs/heads/dev",
          GITHUB_RUN_ID: "99", GITHUB_RUN_ATTEMPT: "1", FEATURE_PR_INPUT: "450", FEATURE_RUN_INPUT: "",
          LOTUS_RELEASE_TAG_RULESET_ID: "7",
          EXPECTED_SOURCE_SHA_INPUT: source, SOURCE_REF_INPUT: "refs/tags/lotus-next-v2026.10.30",
          LOTUS_NEXT_RELEASE_VERSION: "2026.10.30", SOURCE_RECEIPT_PATH: output, GITHUB_OUTPUT: join(root, "outputs"),
          SOURCE_TAG_RESERVE: String(reserve), SOURCE_LOST_REF: String(change === "lost ref response"),
          SOURCE_REGISTRY_STATUS: change === "registry published" ? "200" : change === "registry unknown" ? "503" : "404",
          SOURCE_API_LOG: calls, SOURCE_API_ROUTES: JSON.stringify(routes) } })
      return { ...result, source, controller, tree, receipt: result.status === 0 ? JSON.parse(readFileSync(output, "utf8")) : null,
        calls: readFileSync(calls, "utf8").trim().split("\n") }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  it("admits an unchanged old source when all original feature run/artifact records are unavailable", () => {
    const result = runSource()
    expect(result.status, result.stderr).toBe(0)
    expect(result.receipt).toMatchObject({ sourceSha: result.source, sourceTree: result.tree, workflowSha: result.controller, featurePr: 450 })
    expect(result.source).not.toBe(result.controller)
    for (const key of ["testedSnapshot", "featureRun", "featureRunAttempt"]) expect(result.receipt).not.toHaveProperty(key)
    expect(result.calls.filter(route => route.startsWith("actions/"))).toEqual([])
    expect(result.receipt.tagProtection).toEqual({ rulesetId: 7, bypassActorsVisible: false })
  })
  it.each(["new tag", "lost ref response"])("reserves %s through the actual CLI and local Git ref/object readback", change => {
    const result = runSource(change)
    expect(result.status, result.stderr).toBe(0)
    expect(result.calls.filter(call => call.startsWith("POST "))).toEqual(["POST git/tags", "POST git/refs"])
    expect(result.calls.indexOf("npm vacancy")).toBeLessThan(result.calls.indexOf("POST git/tags"))
    expect(result.receipt.runId).toBe("99")
  })
  it.each(["registry published", "registry unknown"])("leaves no version reservation when %s", change => {
    const result = runSource(change)
    expect(result.status).toBe(1)
    expect(result.calls.some(call => call.startsWith("POST "))).toBe(false)
  })
  it.each(["unprotected Dev", "disabled Dev protection", "missing required feature check", "wrong feature check app", "administrators exempted",
    "unaccepted controller", "non-ancestor source", "moved release ref", "forged Git parents", "moved tag"])(
    "fails closed for %s without tests or product builds", change => { expect(runSource(change).status).toBe(1) },
  )
})


describe("historical publication boundary", () => {
  it("keeps new Dev receipts out of the existing historical parser", () => {
    const feature = readFileSync(".github/workflows/ci.yml", "utf8")
    const historical = readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8")
    expect(() => acceptanceJobNames(feature)).toThrow(/Unknown acceptance workflow graph/)
    expect(() => devFeatureJobNames(historical)).toThrow()
  })
  it("rejects a feature graph with missing or duplicate matrix coverage", () => {
    const feature = readFileSync(".github/workflows/ci.yml", "utf8")
    expect(() => devFeatureJobNames(feature.replace("          - 4\n", "          - 3\n"))).toThrow()
  })
})
