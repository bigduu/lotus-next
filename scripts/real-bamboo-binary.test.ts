import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REAL_BAMBOO_BINARY, REAL_BAMBOO_REVISION, verifyBambooBinary } from "../e2e/support/realBambooRuntime.ts";

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
  it("pins the official release used by Bodhi rather than the old fixture backend", () => {
    expect(REAL_BAMBOO_REVISION).toBe("5b317e4e1900177399f601e775d10253bbea7289");
    expect(REAL_BAMBOO_BINARY).toEqual({
      url: "https://github.com/bigduu/Bamboo-agent/releases/download/v2026.10.17/bamboo-x86_64-unknown-linux-gnu",
      bytes: 245505088,
      sha256: "194cc3f027d44436072251f0965388edd81eaa34942e07b6b823d9cd36123931",
    });
    expect(() => verifyBambooBinary(elf)).toThrow(/length mismatch/);
  });
});
