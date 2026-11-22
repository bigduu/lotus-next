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

export function codexHandoffCommand(offer: PreparedOffer, url: URL, windows: boolean): string {
  const payload = JSON.stringify({ offer_id: offer.offer_id })
  if (windows) {
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
    return `& { $null = Get-Command codex -ErrorAction Stop; $bambooHandoffPrompt = Invoke-RestMethod -Method Post -Uri ${quote(url.href)} -ContentType 'application/json' -Body ${quote(payload)} -TimeoutSec 15 -ErrorAction Stop; & codex --cd ${quote(offer.cwd)} -- ([string]$bambooHandoffPrompt) }`
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  return `(command -v codex >/dev/null || { printf '%s\\n' 'Codex CLI is required.' >&2; exit 127; }; bamboo_handoff_prompt=$(curl -q -fsS --noproxy '*' --max-time 15 -H 'Content-Type: application/json' --data ${quote(payload)} ${quote(url.href)}) && codex --cd ${quote(offer.cwd)} -- "$bamboo_handoff_prompt")`
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
