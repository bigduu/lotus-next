import { execFile, execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, toNamespacedPath } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { codexHandoffCommand } from "./codexHandoff"

vi.mock("@services/api", () => ({ apiClient: {} }))

const offer = { offer_id: "11a11111-22b2-43c3-84d4-55e555555555", cwd: "/worktree/陈's project $(false)" }
const claimUrl = new URL("http://127.0.0.1:8542/api/v1/tickets/codex-handoff/claim")
const unixShells = existsSync("/bin/zsh") ? ["/bin/bash", "/bin/zsh"] : ["/bin/bash"]

it.skipIf(process.platform === "win32").each(unixShells)("checks the Work directory and keeps arguments literal in %s", (shell) => {
  const paths = mkdtempSync(join(tmpdir(), "lotus-codex-handoff-"))
  try {
    const workspace = join(paths, "陈's project $(false)")
    const claimLog = join(paths, "claim.log")
    writeFileSync(join(paths, "curl"), "#!/bin/sh\n: > \"$LOTUS_TEST_CLAIM_LOG\"\nprintf '%s' '目标; $(false) \"quoted\"'\n", { mode: 0o700 })
    writeFileSync(join(paths, "codex"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o700 })
    const args = ["-c", codexHandoffCommand({ ...offer, cwd: workspace }, claimUrl, false)]
    const options = { env: { PATH: paths, LOTUS_TEST_CLAIM_LOG: claimLog }, encoding: "utf8" as const }

    const missing = spawnSync(shell, args, options)
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain("The Work checkout is unavailable.")
    expect(existsSync(claimLog)).toBe(false)

    mkdirSync(workspace)
    const argv = execFileSync(shell, args, options).trimEnd().split("\n")
    expect(existsSync(claimLog)).toBe(true)
    expect(argv).toEqual(["--cd", workspace, "--", '目标; $(false) "quoted"'])
  } finally {
    rmSync(paths, { recursive: true, force: true })
  }
})

it("keeps PowerShell data out of the command syntax and posts directly to loopback", () => {
  const cwd = "C:\\worktree\\O’Connor's 中文\\"
  const command = codexHandoffCommand({ ...offer, cwd }, claimUrl, true)
  const literals = Array.from(command.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g), ([, data]) =>
    Buffer.from(data, "base64").toString("utf8"))
  expect(literals).toEqual([cwd, JSON.stringify({ offer_id: offer.offer_id }), claimUrl.href])
  expect(command).not.toContain(cwd)
  expect(command).toContain("$handler.UseProxy = $false")
  expect(command).toContain("$handler.AllowAutoRedirect = $false")
  expect(command.indexOf("Get-Command node.exe")).toBeLessThan(command.indexOf(".PostAsync("))
  expect(command).toContain("[System.Diagnostics.Process]::Start($launch)")
})

const defaultPowershellPrograms = process.platform === "win32" ? ["powershell.exe", "pwsh.exe"] : ["pwsh"]
const powershellPrograms = process.env.LOTUS_TEST_POWERSHELL
  ? [process.env.LOTUS_TEST_POWERSHELL]
  : defaultPowershellPrograms.flatMap((program) => {
    const result = spawnSync(program, ["-NoProfile", "-Command", "(Get-Process -Id $PID).Path"], { encoding: "utf8" })
    return result.status === 0 ? [result.stdout.trim()] : []
  })
const runFile = promisify(execFile)

it.each(powershellPrograms)("runs the handoff with literal arguments in %s", async (powershell) => {
  const paths = mkdtempSync(join(tmpdir(), "lotus-codex-powershell-"))
  const workspace = join(paths, "O’Connor's 中文")
  const cwd = toNamespacedPath(workspace) + "\\"
  const prompt = '目标 "approval"\\\"\r\npaths \\\\ before quote: \\\\"𐀀"\\\n'
  const requests: Array<{ method: string | undefined; url: string | undefined; body: string }> = []
  const server = createServer(async (request, response) => {
    request.setEncoding("utf8")
    let body = ""
    for await (const chunk of request) body += chunk
    requests.push({ method: request.method, url: request.url, body })
    if (request.url === "/redirect") {
      response.writeHead(307, { Location: "/claim" }).end()
    } else {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(prompt)
    }
  })
  try {
    // A trailing backslash is a directory separator on Windows and a literal Unix name.
    mkdirSync(process.platform === "win32" ? workspace : cwd)
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Test server has no TCP address")
    const env = { ...process.env }
    for (const name of Object.keys(env)) {
      if (name.toLowerCase() === "path") delete env[name]
    }
    env.PATH = paths
    const invoke = (route: string) => {
      const endpoint = new URL("http://127.0.0.1:" + address.port + route)
      const script = codexHandoffCommand({ ...offer, cwd }, endpoint, true)
      return runFile(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64")], { env })
    }

    await expect(invoke("/claim")).rejects.toThrow("Install the native Codex CLI")
    expect(requests).toEqual([])

    writeFileSync(join(paths, "codex.ps1"), "throw 'The npm shim must not be invoked.'", { mode: 0o700 })
    const entry = join(paths, "node_modules", "@openai", "codex", "bin")
    mkdirSync(entry, { recursive: true })
    writeFileSync(join(entry, "codex.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)))")
    if (process.platform === "win32") {
      env.PATH = [paths, dirname(process.execPath)].join(delimiter)
    } else {
      symlinkSync(process.execPath, join(paths, "node.exe"))
    }

    await expect(invoke("/redirect")).rejects.toThrow("Bamboo handoff failed (HTTP 307)")
    const expectedArgv = ["--cd", cwd, "--", prompt]
    const { stdout } = await invoke("/claim")
    expect(JSON.parse(stdout)).toEqual(expectedArgv)
    const body = JSON.stringify({ offer_id: offer.offer_id })
    expect(requests).toEqual([{ method: "POST", url: "/redirect", body }, { method: "POST", url: "/claim", body }])

    if (process.platform !== "win32") {
      env.LOTUS_TEST_CODEX_ENTRY = join(entry, "codex.js")
      writeFileSync(join(paths, "codex.exe"), '#!/bin/sh\nexec node.exe "$LOTUS_TEST_CODEX_ENTRY" "$@"\n', { mode: 0o700 })
      const native = await invoke("/claim")
      expect(JSON.parse(native.stdout)).toEqual(expectedArgv)
    }
  } finally {
    server.close()
    rmSync(paths, { recursive: true, force: true })
  }
}, 15_000)
