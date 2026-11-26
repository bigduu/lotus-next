import { afterEach, describe, expect, it, vi } from "vitest"
import { discardComposerDrafts, localDraftOrigin, readComposerDraft, saveComposerDraft } from "./recoverableDrafts"

const scope = { origin: "http://127.0.0.1:9562", sessionId: "root-session", birthToken: "a".repeat(64) }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  discardComposerDrafts()
})

describe("tab-local unsent composer drafts", () => {
  it("requires the exact same-origin loopback endpoint and no opener", () => {
    const location = new URL(scope.origin) as unknown as Location
    expect(localDraftOrigin(scope.origin, location, false)).toBe(scope.origin)
    expect(localDraftOrigin(scope.origin, location, true)).toBeNull()
    expect(localDraftOrigin("http://127.0.0.1:9563", location, false)).toBeNull()
    const remote = new URL("https://some-host.test") as unknown as Location
    expect(localDraftOrigin(remote.origin, remote, false)).toBeNull()
  })

  it("isolates a session lifetime and clears or expires the exact receipt", () => {
    vi.useFakeTimers()
    saveComposerDraft(scope, " draft\nwithout loss ")
    expect(readComposerDraft(scope)).toBe(" draft\nwithout loss ")
    expect(readComposerDraft({ ...scope, birthToken: "b".repeat(64) })).toBeUndefined()
    expect(readComposerDraft({ ...scope, sessionId: "other-root" })).toBeUndefined()
    expect(readComposerDraft({ ...scope, origin: "http://127.0.0.1:9563" })).toBeUndefined()
    saveComposerDraft(scope, "")
    expect(readComposerDraft(scope)).toBeUndefined()
    saveComposerDraft(scope, "old")
    vi.advanceTimersByTime(8 * 60 * 60 * 1_000)
    expect(readComposerDraft(scope)).toBeUndefined()
  })

  it("caps text and treats unavailable storage as optional", () => {
    saveComposerDraft(scope, "draft")
    saveComposerDraft(scope, "x".repeat(8_193))
    expect(readComposerDraft(scope)).toBeUndefined()
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("closed") } })
    expect(() => saveComposerDraft(scope, "draft")).not.toThrow()
    expect(readComposerDraft(scope)).toBeUndefined()
  })
})
