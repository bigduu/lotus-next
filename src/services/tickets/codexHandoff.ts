import { apiClient } from "@services/api"

const route = "tickets/codex-handoff"
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"])

export interface CodexHandoffSelector {
  project_id: string
  work_id: string
  generation: number
  record_revision: number
  authority_epoch: number
}

interface PreparedOffer {
  offer_id: string
  cwd: string
}

export function localCodexClaimUrl(): URL | null {
  if (typeof window === "undefined") return null
  const url = new URL(apiClient.resolveUrl(`${route}/claim`), window.location.href)
  if (!localHosts.has(window.location.hostname) || !localHosts.has(url.hostname)
    || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return null
  return url
}

function powershellUtf8Literal(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))`
}

function powershellHandoffCommand(cwd: string, url: URL, payload: string): string {
  // Build the native argument string directly so PowerShell cannot rewrite it.
  return String.raw`& {
  $ErrorActionPreference = 'Stop'
  $workspace = ${powershellUtf8Literal(cwd)}
  if (-not [System.IO.Directory]::Exists($workspace)) {
    # Older .NET Framework path checks may need the ordinary form of Bamboo's canonical path.
    $checkPath = $workspace
    if ($workspace.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
      $checkPath = '\\' + $workspace.Substring(8)
    } elseif ($workspace -match '^\\\\\?\\[A-Za-z]:\\') {
      $checkPath = $workspace.Substring(4)
    }
    if ($checkPath -eq $workspace -or -not [System.IO.Directory]::Exists($checkPath)) {
      throw 'The Work checkout is unavailable.'
    }
  }

  $launch = [System.Diagnostics.ProcessStartInfo]::new()
  $launch.UseShellExecute = $false
  $prefix = @()
  $codex = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $codex) {
    $launch.FileName = $codex.Path
  } else {
    $shim = Get-Command codex.ps1,codex.cmd -CommandType ExternalScript,Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $shim) { throw 'Install the native Codex CLI or the @openai/codex npm package.' }
    $shimDirectory = [System.IO.Path]::GetDirectoryName($shim.Path)
    $entry = Join-Path $shimDirectory 'node_modules/@openai/codex/bin/codex.js'
    if (-not [System.IO.File]::Exists($entry)) { throw 'The installed @openai/codex npm launcher was not found.' }
    $nodePath = Join-Path $shimDirectory 'node.exe'
    if (-not [System.IO.File]::Exists($nodePath)) {
      $node = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
      $nodePath = $node.Path
    }
    $launch.FileName = $nodePath
    $prefix = @($entry)
  }

  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [System.TimeSpan]::FromSeconds(15)
  $claim = ${powershellUtf8Literal(payload)}
  $uri = ${powershellUtf8Literal(url.href)}
  $request = [System.Net.Http.StringContent]::new($claim, [System.Text.Encoding]::UTF8, 'application/json')
  try {
    $response = $client.PostAsync($uri, $request).GetAwaiter().GetResult()
    try {
      if ([int]$response.StatusCode -ne 200 -or $response.Content.Headers.ContentType.MediaType -ne 'text/plain') {
        throw ('Bamboo handoff failed (HTTP {0}).' -f [int]$response.StatusCode)
      }
      $prompt = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } finally { $response.Dispose() }
  } finally { $request.Dispose(); $client.Dispose() }

  $quoted = foreach ($value in ($prefix + @('--cd', $workspace, '--', $prompt))) {
    $escaped = [System.Text.RegularExpressions.Regex]::Replace($value, '(\\*)"', '$1$1\"')
    $escaped = [System.Text.RegularExpressions.Regex]::Replace($escaped, '(\\+)\z', '$1$1')
    '"' + $escaped + '"'
  }
  $launch.Arguments = $quoted -join ' '
  $process = [System.Diagnostics.Process]::Start($launch)
  try {
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw ('Codex exited with code {0}.' -f $process.ExitCode) }
  } finally { $process.Dispose() }
}`
}

export function codexHandoffCommand(offer: PreparedOffer, url: URL, windows: boolean): string {
  const payload = JSON.stringify({ offer_id: offer.offer_id })
  if (windows) return powershellHandoffCommand(offer.cwd, url, payload)
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  const workspace = quote(offer.cwd)
  return `(
  command -v codex >/dev/null || { printf '%s\\n' 'Codex CLI is required.' >&2; exit 127; }
  (cd -- ${workspace}) >/dev/null 2>&1 || { printf '%s\\n' 'The Work checkout is unavailable.' >&2; exit 1; }
  bamboo_handoff_prompt=$(curl -q -fsS --noproxy '*' --max-time 15 -H 'Content-Type: application/json' --data ${quote(payload)} ${quote(url.href)}) &&
    codex --cd ${workspace} -- "$bamboo_handoff_prompt"
)`
}

export async function prepareCodexHandoff(selector: CodexHandoffSelector, signal: AbortSignal): Promise<string | null> {
  const url = localCodexClaimUrl()
  if (!url) return null
  const offer = await apiClient.post<PreparedOffer>(route, selector, { signal })
  if (typeof offer?.offer_id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(offer.offer_id)
    || typeof offer.cwd !== "string" || !offer.cwd || offer.cwd.includes("\u0000")) {
    throw new Error("Invalid Work handoff response")
  }
  return codexHandoffCommand(offer, url, /Windows/i.test(navigator.userAgent))
}
