const storageKey = "lotus-next.recoverable-composer-drafts.v1"
const maxDrafts = 4
const maxTextLength = 8_192
const lifetimeMs = 8 * 60 * 60 * 1_000

export type ComposerDraftScope = Readonly<{
  origin: string
  sessionId: string
  birthToken: string
}>

type Draft = ComposerDraftScope & { text: string; savedAt: number }

// The native desktop's one workspace uses this same-origin loopback path.
// Other tabs opened by a page can inherit a copy of its sessionStorage.
export function localDraftOrigin(endpoint: string, location: Location, hasOpener: boolean): string | null {
  if (hasOpener || endpoint !== location.origin) return null
  return location.protocol === "http:" && location.hostname === "127.0.0.1" ? endpoint : null
}

function isDraft(value: unknown, now: number): value is Draft {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<Draft>
  return typeof item.origin === "string" && item.origin.length <= 256
    && typeof item.sessionId === "string" && item.sessionId.length > 0 && item.sessionId.length <= 256
    && typeof item.birthToken === "string" && /^[0-9a-f]{64}$/i.test(item.birthToken)
    && typeof item.text === "string" && item.text.length > 0 && item.text.length <= maxTextLength
    && typeof item.savedAt === "number" && item.savedAt <= now && item.savedAt > now - lifetimeMs
}

function matches(draft: ComposerDraftScope, scope: ComposerDraftScope) {
  return draft.origin === scope.origin && draft.sessionId === scope.sessionId && draft.birthToken === scope.birthToken
}

function readDrafts(now: number): Draft[] {
  const raw = sessionStorage.getItem(storageKey)
  if (!raw || raw.length > maxDrafts * (maxTextLength * 6 + 1_000)) return []
  try {
    const rows: unknown = JSON.parse(raw)
    return Array.isArray(rows) ? rows.slice(0, maxDrafts).filter((row): row is Draft => isDraft(row, now)) : []
  } catch {
    return []
  }
}

function writeDrafts(drafts: Draft[]): void {
  if (drafts.length) sessionStorage.setItem(storageKey, JSON.stringify(drafts.slice(0, maxDrafts)))
  else sessionStorage.removeItem(storageKey)
}

export function readComposerDraft(scope: ComposerDraftScope): string | undefined {
  try {
    return readDrafts(Date.now()).find((draft) => matches(draft, scope))?.text
  } catch {
    return undefined
  }
}

export function saveComposerDraft(scope: ComposerDraftScope, text: string): void {
  try {
    const now = Date.now()
    const remaining = readDrafts(now).filter((draft) => !matches(draft, scope))
    const draft = { ...scope, text, savedAt: now }
    if (isDraft(draft, now)) remaining.unshift(draft)
    writeDrafts(remaining)
  } catch {
    // Prefer the live input to a receipt that may no longer reflect it.
    discardComposerDrafts()
  }
}

export function discardComposerDraftForSession(origin: string, sessionId: string): void {
  try {
    const drafts = readDrafts(Date.now())
    const remaining = drafts.filter((draft) => draft.origin !== origin || draft.sessionId !== sessionId)
    if (remaining.length !== drafts.length) writeDrafts(remaining)
  } catch {
    discardComposerDrafts()
  }
}

export function discardComposerDrafts(): void {
  try { sessionStorage.removeItem(storageKey) } catch { /* Storage may be unavailable. */ }
}
