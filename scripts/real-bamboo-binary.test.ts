import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REAL_BAMBOO_BINARY, REAL_BAMBOO_REVISION, FEATURE_BAMBOO_HOST_REVISION, assertFeatureBambooHostPair, resolveFeatureBrowserHost, verifyBambooBinary } from "../e2e/support/realBambooRuntime.ts";

describe("published Bamboo executable admission", () => {
  const elf = Buffer.alloc(32);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  elf[18] = 62;
  const identity = { bytes: elf.length, sha256: createHash("sha256").update(elf).digest("hex") };
  it("validates exact bytes and Linux architecture before assembling the image", () => {
    expect(() => verifyBambooBinary(elf, identity)).not.toThrow();
    expect(() => verifyBambooBinary(elf.subarray(0, 30), identity)).toThrow(/length mismatch/);
    const changed = Buffer.from(elf); changed[31] = 1;
    expect(() => verifyBambooBinary(changed, identity)).toThrow(/SHA-256 mismatch/);
    const wrongArch = Buffer.from(elf); wrongArch[18] = 183;
    expect(() => verifyBambooBinary(wrongArch, { bytes: 32, sha256: createHash("sha256").update(wrongArch).digest("hex") })).toThrow(/Linux x86_64/);
  });
  it("pins the released executable and matching source for the real runtime", () => {
    expect(REAL_BAMBOO_REVISION).toBe("4786b7db862cabbebce49e288da62b284ccf5b72");
    expect(REAL_BAMBOO_BINARY).toEqual({
      url: "https://github.com/bigduu/Bamboo-agent/releases/download/v2026.10.19/bamboo-x86_64-unknown-linux-gnu",
      bytes: 248709064,
      sha256: "f37f51bafe1d49055adcb0e1b51067e2f9a07ad0cb36497a91f86889e5773286",
    });
    expect(() => verifyBambooBinary(elf)).toThrow(/length mismatch/);
  });
});


describe("feature-only Bamboo browser-host pairing", () => {
  const feature = {
    GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "bigduu/lotus-next", GITHUB_EVENT_NAME: "pull_request",
    GITHUB_BASE_REF: "dev", GITHUB_REF: "refs/pull/450/merge",
    BAMBOO_E2E_HOST_REVISION: "4786b7db862cabbebce49e288da62b284ccf5b72",
    BAMBOO_E2E_HOST_SOURCE_DIR: "/tmp/accepted-bamboo-host",
  }
  const pair = {
    binaryRevision: "4786b7db862cabbebce49e288da62b284ccf5b72",
    hostRevision: "4786b7db862cabbebce49e288da62b284ccf5b72",
    binaryAdapterTree: "55390529b9823112c56ce9c993c4aa8ad473cd01",
    hostAdapterTree: "55390529b9823112c56ce9c993c4aa8ad473cd01",
    binaryHostBlob: "3c6a6e5463394bc689f95528446c9fc983e150a6",
    hostHostBlob: "3c6a6e5463394bc689f95528446c9fc983e150a6",
    binaryPackageBlob: "4df53cb8e1e41e1e6a34ad5e65843a866ae8101d",
    hostPackageBlob: "4df53cb8e1e41e1e6a34ad5e65843a866ae8101d",
    binaryLockBlob: "f29cb9346fdd3fcd00fbc24789c646c86c1441ac",
    hostLockBlob: "f29cb9346fdd3fcd00fbc24789c646c86c1441ac",
  }
  it("admits only the exact feature PR host source and retains same-source publication defaults", () => {
    expect(FEATURE_BAMBOO_HOST_REVISION).toBe(pair.hostRevision)
    expect(resolveFeatureBrowserHost(feature)).toEqual({ mode: "feature-pair", directory: feature.BAMBOO_E2E_HOST_SOURCE_DIR })
    expect(resolveFeatureBrowserHost({})).toEqual({ mode: "same-source" })
    expect(resolveFeatureBrowserHost({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch" })).toEqual({ mode: "same-source" })
    expect(() => assertFeatureBambooHostPair(pair)).not.toThrow()
  })
  it.each(Object.keys(pair))("rejects incompatible or substituted %s", (key) => {
    expect(() => assertFeatureBambooHostPair({ ...pair, [key]: "0".repeat(40) })).toThrow()
  })
  it.each([
    { BAMBOO_E2E_HOST_SOURCE_DIR: undefined }, { BAMBOO_E2E_HOST_REVISION: undefined },
    { BAMBOO_E2E_HOST_REVISION: "0".repeat(40) }, { BAMBOO_E2E_HOST_SOURCE_DIR: "relative" },
    { GITHUB_REPOSITORY: "other/lotus-next" }, { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { GITHUB_BASE_REF: "main" }, { GITHUB_REF: "refs/heads/dev" },
    { PUBLICATION_WORKFLOW_SHA: "a".repeat(40) }, { LOTUS_NEXT_RELEASE_SOURCE_RECEIPT: "/tmp/release.json" },
    { LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: "/tmp/release-source" },
  ])("rejects unscoped or publication host selection %j", (change) => {
    expect(() => resolveFeatureBrowserHost({ ...feature, ...change })).toThrow()
  })
})
