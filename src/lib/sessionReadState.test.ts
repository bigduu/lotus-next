import { describe, expect, it } from "vitest"
import { isSessionUnread, mergeReadMarker, parseReadState } from "./sessionReadState"

describe("session read markers", () => {
  it("marks opened content read and detects later activity", () => {
    const chat = { id: "a", messageCount: 2, lastActivityAt: "2026-09-07T00:00:00Z" }
    expect(isSessionUnread(chat, {})).toBe(true)
    const state = mergeReadMarker({}, chat, 1)
    expect(isSessionUnread(chat, state)).toBe(false)
    expect(isSessionUnread({ ...chat, messageCount: 3 }, state)).toBe(true)
    expect(isSessionUnread({ ...chat, lastActivityAt: "2026-09-07T00:01:00Z" }, state)).toBe(true)
    expect(mergeReadMarker(state, { ...chat, messageCount: 1 })).toBe(state)
  })
  it("does not mark empty sessions or title-only updates unread", () => {
    const chat = { id: "a", messageCount: 2 }
    const state = mergeReadMarker({}, chat)
    expect(isSessionUnread({ ...chat, updatedAt: "2026-09-08T00:00:00Z" }, state)).toBe(false)
    expect(isSessionUnread({ id: "empty", messageCount: 0 }, {})).toBe(false)
  })
  it("ignores corrupt storage and bounds retained markers", () => {
    expect(parseReadState("not-json")).toEqual({})
    expect(parseReadState('{"a":{"at":"bad"}}')).toEqual({})
    const state = Object.fromEntries(Array.from({ length: 2_100 }, (_, i) => [String(i), { at: i, count: 1, readAt: i }]))
    const parsed = parseReadState(JSON.stringify(state))
    expect(Object.keys(parsed)).toHaveLength(2_000)
    expect(parsed["0"]).toBeUndefined()
  })
})
