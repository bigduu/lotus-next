import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/publish-npm.yml"), "utf8")
const section = workflow.split("      - name: Download and verify the registry copy\n")[1].split("\n      - name:")[0]
const body = section.split("        run: |\n")[1].split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n")
const version = "2026.10.12"
const verifiedBytes = Buffer.from("verified registry fixture")
const shasum = createHash("sha1").update(verifiedBytes).digest("hex")
const integrity = "sha512-" + createHash("sha512").update(verifiedBytes).digest("base64")

const run = (mode, verifyHashes = false) => {
  const root = mkdtempSync(path.join(tmpdir(), "lotus-registry-readback-test-"))
  try {
    const bin = path.join(root, "bin"); mkdirSync(bin)
    const log = path.join(root, "calls.jsonl")
    writeFileSync(path.join(root, "local.tgz"), verifiedBytes)
    writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2), operation = args[0];
if (!["pack", "view"].includes(operation)) throw Error("Forbidden npm operation");
const log = process.env.READBACK_TEST_LOG;
let previous = []; try { previous = fs.readFileSync(log, "utf8").trim().split("\\n").filter(Boolean); } catch {}
fs.appendFileSync(log, JSON.stringify(args) + "\\n");
const mode = process.env.READBACK_TEST_MODE;
const destination = args[args.indexOf("--pack-destination") + 1];
const fail = mode === "permanent" || mode === "auth" || mode === "mixed" || mode === "wrong-version" ||
  (mode === "pack-transient" && previous.length === 0) ||
  (mode === "view-transient" && previous.length === 1);
if (fail) {
  if (operation === "pack") fs.writeFileSync(path.join(destination, "partial.tgz"), "never select a failed attempt");
  const code = mode === "auth" ? "E401" : "ETARGET";
  process.stderr.write("npm error code " + code + "\\n");
  process.stderr.write("npm error notarget No matching version found for @bigduu/lotus-next@" +
    (mode === "wrong-version" ? "2099.1.1" : process.env.LOTUS_NEXT_RELEASE_VERSION) + ".\\n");
  if (mode === "mixed") process.stderr.write("npm error code E401\\n");
  process.exit(1);
}
if (operation === "pack") {
  fs.writeFileSync(path.join(destination, "registry.tgz"), mode === "bad-bytes" ? "corrupted" : "verified registry fixture");
  process.stdout.write("registry.tgz\\n");
} else {
  process.stdout.write(JSON.stringify({ shasum: process.env.EXPECTED_SHASUM, integrity: process.env.EXPECTED_INTEGRITY,
    ...(mode === "no-provenance" ? {} : { attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } } }) }));
}
`, { mode: 0o755 })
    if (mode === "permanent") {
      // This case isolates the actual shell's attempt bound. Exact ETARGET,
      // authentication and wrong-version classification run with real Node in
      // the cases above; do not spawn that same parser 121 redundant times.
      writeFileSync(path.join(bin, "node"), "#!/bin/sh\ncat >/dev/null\nexit 0\n", { mode: 0o755 })
      writeFileSync(path.join(bin, "npm"), `#!/bin/bash
printf '["%s"]\\n' "$1" >> "$READBACK_TEST_LOG"
destination=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = --pack-destination ]; then shift; destination="$1"; fi
  shift
done
printf 'unusable partial bytes' > "$destination/partial.tgz"
printf 'npm error code ETARGET\\nnpm error notarget No matching version found for @bigduu/lotus-next@%s.\\n' "$LOTUS_NEXT_RELEASE_VERSION" >&2
exit 1
`, { mode: 0o755 })
    }
    const script = body.split(verifyHashes ? '\ntar -xzf ' : '\nexport REGISTRY_TARBALL')[0]
    const result = spawnSync("bash", ["-eu", "-c", script + '\nprintf "\\nSELECTED=%s\\n" "$REGISTRY_TARBALL"'], {
      cwd: root, encoding: "utf8", timeout: 25000,
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, RUNNER_TEMP: root,
        READBACK_TEST_MODE: mode, READBACK_TEST_LOG: log, LOTUS_NEXT_RELEASE_VERSION: version,
        LOCAL_TARBALL: path.join(root, "local.tgz"), EXPECTED_SHASUM: shasum, EXPECTED_INTEGRITY: integrity },
    })
    let calls = []; try { calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) } catch {}
    const selected = result.stdout?.match(/SELECTED=(.*)/)?.[1]
    const selectedBytes = selected ? readFileSync(selected, "utf8") : null
    return { ...result, calls, selected, selectedBytes }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe("original publisher registry readback", () => {
  it.each(["success", "pack-transient", "view-transient"])("accepts only a fully successful fresh readback: %s", (mode) => {
    const result = run(mode)
    expect(result.status, result.stderr).toBe(0)
    expect(result.selectedBytes).toBe(verifiedBytes.toString())
    const packs = result.calls.filter((args) => args[0] === "pack")
    expect(packs).toHaveLength(mode === "success" ? 1 : 2)
    const caches = packs.map((args) => args.find((arg) => arg.startsWith("--cache=")))
    expect(new Set(caches).size).toBe(packs.length)
    for (const args of result.calls) {
      assert.equal(args[1], "@bigduu/lotus-next@" + version)
      expect(args).toContain("--prefer-online")
      expect(args).toContain("--registry=https://registry.npmjs.org/")
      if (args[0] === "pack") expect(args).toContain("--ignore-scripts")
    }
  })

  it.each(["auth", "mixed", "wrong-version"])("fails immediately instead of retrying %s", (mode) => {
    const result = run(mode)
    expect(result.status).not.toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.selected).toBeUndefined()
  })

  it("bounds unavailable-version retries and never selects partial bytes", () => {
    const result = run("permanent")
    expect(result.status).not.toBe(0)
    expect(result.calls).toHaveLength(121)
    expect(result.selected).toBeUndefined()
  }, 30000)

  it.each(["bad-bytes", "no-provenance"])("preserves the original fail-closed verification for %s", (mode) => {
    const result = run(mode, true)
    expect(result.status).not.toBe(0)
    expect(result.calls.map((args) => args[0])).toEqual(["pack", "view"])
    expect(result.stderr).toContain(mode === "bad-bytes" ? "SHA-1 does not match" : "no SLSA provenance")
  })
})
