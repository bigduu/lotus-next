import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "vitest"
import { JOBS, STEPS } from "./release-npm-lifecycle.mjs"

const yaml = readFileSync(path.resolve(".github/workflows/publish-npm.yml"), "utf8")
const cli = readFileSync(path.resolve("scripts/release-npm-lifecycle.mjs"), "utf8")
function validate(text) {
  const blocks = Object.fromEntries([...text.matchAll(/^  (prepare|build|finalize):\n([\s\S]*?)(?=^  [a-z][a-z_]*:\n|$(?![\s\S]))/gmu)].map(match => [match[1], match[2]]))
  assert.deepEqual(Object.keys(blocks), ["prepare", "build", "finalize"])
  assert.match(text, /on:\n  workflow_dispatch:/u)
  assert.doesNotMatch(text, /^  (push|pull_request|pull_request_target|schedule|workflow_run|release):/mu)
  assert.match(text, /cancel-in-progress: false/u)
  for (const [key, body] of Object.entries(blocks)) {
    assert.ok(body.includes("name: " + JOBS[key]))
    assert.ok(body.includes("ref: ${{ github.workflow_sha }}\n          path: controller"))
    assert.doesNotMatch(body, /persist-credentials: true|GITHUB_(?:SHA|REF|EVENT_NAME|JOB):/u)
    assert.match(body, /node-version: 24\n          package-manager-cache: false/u)
    assert.doesNotMatch(body, /npm run (?:test|verify|build)|playwright|test:e2e|tsc|vite build|cargo|build-native/u)
    for (const run of body.matchAll(/        run: (.+)/gu)) assert.match(run[0], /working-directory: controller|run: node scripts\/release-npm-lifecycle\.mjs /u)
    assert.equal((body.match(/working-directory: controller/gu) ?? []).length, (body.match(/        run: /gu) ?? []).length)
  }
  assert.match(blocks.prepare, /permissions:\n      contents: write\n      actions: read/u)
  assert.match(blocks.prepare, /run: node scripts\/release-npm-lifecycle\.mjs reserve/u)
  assert.match(blocks.build, /permissions:\n      contents: read\n      actions: read/u)
  assert.match(blocks.build, /needs: \[prepare\]/u)
  assert.ok(blocks.build.includes("ref: ${{ inputs.expected_source_sha }}\n          path: source"))
  assert.ok(blocks.build.includes("SOURCE_ROOT: ${{ github.workspace }}/source"))
  assert.ok(blocks.build.indexOf(STEPS.select) < blocks.build.indexOf("Install locked controller"))
  for (const name of ["Install locked controller and product dependencies", STEPS.build, STEPS.pack, STEPS.upload])
    assert.ok(blocks.build.includes("- name: " + name + "\n        if: steps.original.outputs.mode == 'build'"))
  assert.ok(blocks.build.includes("- name: " + STEPS.restore + "\n        if: steps.original.outputs.mode == 'restore'"))
  assert.equal((text.match(/uses: actions\/upload-artifact@v7/gu) ?? []).length, 1)
  assert.ok(blocks.build.includes("name: lotus-next-original-${{ github.run_id }}-${{ github.run_attempt }}"))
  assert.ok(blocks.build.includes("path: ${{ runner.temp }}/lotus-npm-${{ github.run_id }}-${{ github.run_attempt }}-build/original.zip"))
  assert.match(blocks.build, /retention-days: 90\n          overwrite: false/u)
  assert.match(blocks.finalize, /needs: \[prepare, build\]/u)
  assert.match(blocks.finalize, /contents: write\n      actions: read\n      id-token: write/u)
  assert.ok(blocks.finalize.includes("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}"))
  for (const key of ["prepare", "build"]) assert.doesNotMatch(blocks[key], /NODE_AUTH_TOKEN|NPM_TOKEN|id-token: write/u)
  assert.doesNotMatch(blocks.finalize, /path: source|actions\/download-artifact|\bmjs (?:build|pack|install)\b/u)
  assert.match(blocks.finalize, /run: node scripts\/release-npm-lifecycle\.mjs finalize/u)
}
describe("current frozen-source original npm producer", () => {
  it("has one read-only Node24 builder and a trusted original-only finalizer without release tests", () => validate(yaml))
  for (const [name, before, after] of [
    ["main push repetition", "on:\n", "on:\n  push:\n"],
    ["candidate-defined controller", "ref: ${{ github.workflow_sha }}", "ref: ${{ inputs.expected_source_sha }}"],
    ["unguarded rebuild on recovery", "if: steps.original.outputs.mode == 'build'", "if: always()"],
    ["builder publication authority", "permissions:\n      contents: read\n      actions: read", "permissions:\n      contents: write\n      actions: read"],
    ["npm credential in source job", "SOURCE_ROOT:", "NODE_AUTH_TOKEN: forbidden\n      SOURCE_ROOT:"],
    ["formal compilation in finalizer", "mjs finalize", "mjs build"],
    ["artifact overwrite", "overwrite: false", "overwrite: true"],
  ]) it("rejects " + name, () => assert.throws(() => validate(yaml.replace(before, after))))
  it("keeps C checks and S build roots separate and suppresses prepack without a second pack", () => {
    assert.match(cli, /ports\.npm\(\["ci", "--ignore-scripts"\], controllerRoot\); ports\.npm\(\["ci", "--ignore-scripts"\], sourceRoot\)/u)
    assert.equal((cli.match(/\["--ignore-scripts", "run", "build"\]/gu) ?? []).length, 1)
    assert.equal((cli.match(/\["pack", "--ignore-scripts", "--json"/gu) ?? []).length, 1)
    assert.match(cli, /scripts\/verify-package\.mjs"\), "--pack-result", packResult, "--source-root", sourceRoot/u)
    assert.match(cli, /verifyPackResult\(JSON.parse\(packed\), archive, expected\)/u)
    assert.match(cli, /"publish", filename, "--ignore-scripts", "--provenance"/u)
  })
})
