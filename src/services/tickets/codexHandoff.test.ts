import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { codexHandoffCommand } from "./codexHandoff"

vi.mock("@services/api", () => ({ apiClient: {} }))

const offer = { offer_id: "11a11111-22b2-43c3-84d4-55e555555555", cwd: "/worktree/陈's project $(false)" }
const claimUrl = new URL("http://127.0.0.1:8542/api/v1/tickets/codex-handoff/claim")

it.skipIf(process.platform === "win32")("passes the Work directory and claimed prompt as literal arguments", () => {
  const paths = mkdtempSync(join(tmpdir(), "lotus-codex-handoff-"))
  try {
    writeFileSync(join(paths, "curl"), "#!/bin/sh\nprintf '%s' '目标; $(false) \"quoted\"'\n", { mode: 0o700 })
    writeFileSync(join(paths, "codex"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o700 })
    const argv = execFileSync("/bin/sh", ["-c", codexHandoffCommand(offer, claimUrl, false)], {
      env: { PATH: paths }, encoding: "utf8",
    }).trimEnd().split("\n")
    expect(argv).toEqual(["--cd", offer.cwd, "--", '目标; $(false) "quoted"'])
  } finally {
    rmSync(paths, { recursive: true, force: true })
  }
})

it("quotes Work directories and uses an explicit PowerShell POST", () => {
  const command = codexHandoffCommand({ ...offer, cwd: "C:\\worktree\\Owner's work" }, claimUrl, true)
  expect(command).toContain("Invoke-RestMethod -Method Post")
  expect(command).toContain("'C:\\worktree\\Owner''s work'")
  expect(command).toContain(offer.offer_id)
})
