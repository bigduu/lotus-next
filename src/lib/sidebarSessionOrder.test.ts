import { beforeEach, describe, expect, it } from "vitest"
import {
  SESSION_ORDER_STORAGE_KEY,
  clearSessionOrder,
  commitSessionOrder,
  compareSidebarSessions,
  parseSessionOrder,
  rankSessionAt,
  recordSessionUserInput,
  sessionOrderSnapshot,
  sessionSortTime,
} from "./sidebarSessionOrder"

const chat = (id: string, createdAt: number) => ({ id, createdAt })
const ids = (chats: Array<{ id: string }>) => chats.map((entry) => entry.id)
/** Render an ordered list exactly as the sidebar does. */
const ordered = (chats: Array<{ id: string; createdAt: number }>, order = sessionOrderSnapshot()) =>
  ids([...chats].sort((left, right) => compareSidebarSessions(left, right, order)))

beforeEach(() => {
  localStorage.clear()
  clearSessionOrder()
})

describe("session order storage", () => {
  it("ignores malformed snapshots instead of throwing", () => {
    expect(parseSessionOrder(null)).toEqual({ version: 1, ranks: {}, activity: {} })
    expect(parseSessionOrder("not json")).toEqual({ version: 1, ranks: {}, activity: {} })
    expect(parseSessionOrder(JSON.stringify({ version: 2, ranks: { a: 1 } }))).toEqual({ version: 1, ranks: {}, activity: {} })
    expect(parseSessionOrder(JSON.stringify({ version: 1, ranks: { a: 1, "": 2, b: "x" }, activity: { c: 5 } })))
      .toEqual({ version: 1, ranks: { a: 1 }, activity: { c: 5 } })
  })

  it("round-trips a committed order through storage", () => {
    commitSessionOrder(recordSessionUserInput("a", 1_000))
    const stored = parseSessionOrder(localStorage.getItem(SESSION_ORDER_STORAGE_KEY))
    expect(stored).toEqual(sessionOrderSnapshot())
    expect(stored.activity.a).toBe(1_000)
    expect(stored.ranks.a).toBe(1)
  })
})

describe("recency", () => {
  it("uses the later of creation and the user's last submission for grouping", () => {
    const order = recordSessionUserInput("old", 9_000)
    expect(sessionSortTime(chat("old", 1_000), order)).toBe(9_000)
    expect(sessionSortTime(chat("fresh", 5_000), order)).toBe(5_000)
  })

  it("keeps the newest submission when an older one arrives late", () => {
    recordSessionUserInput("a", 2_000)
    const order = recordSessionUserInput("a", 1_500)
    expect(order.activity.a).toBe(2_000)
  })

  it("puts the session the user just wrote into ahead of a newer session", () => {
    let order = recordSessionUserInput("written", 7_000)
    const chats = [chat("newer", 9_000), chat("written", 1_000)]
    expect(ordered(chats, order)).toEqual(["written", "newer"])
    // Every new submission in another session moves that one to the front.
    order = recordSessionUserInput("newer", 10_000)
    expect(ordered(chats, order)).toEqual(["newer", "written"])
  })

  it("falls back to creation time for sessions this device never ordered", () => {
    const chats = [chat("older", 1_000), chat("newest", 3_000), chat("middle", 2_000)]
    expect(ordered(chats, sessionOrderSnapshot())).toEqual(["newest", "middle", "older"])
    expect(compareSidebarSessions(chat("older", 1_000), chat("newest", 3_000), sessionOrderSnapshot())).toBeGreaterThan(0)
  })

  it("is stable for identical timestamps", () => {
    const chats = [chat("first", 5_000), chat("second", 5_000)]
    expect(compareSidebarSessions(chats[0]!, chats[1]!, sessionOrderSnapshot())).toBe(0)
    expect(ordered(chats, sessionOrderSnapshot())).toEqual(["first", "second"])
  })
})

describe("drag positions", () => {
  /** Submissions in chronological order: `a` is the most recent one. */
  const written = () => {
    recordSessionUserInput("c", 1_000)
    recordSessionUserInput("b", 2_000)
    return recordSessionUserInput("a", 3_000)
  }
  const three = () => [chat("a", 0), chat("b", 0), chat("c", 0)]

  it("places a session above its target row", () => {
    let order = written()
    expect(ordered(three(), order)).toEqual(["a", "b", "c"])

    order = rankSessionAt(order, ["a", "b", "c"], "c", "a", false)
    expect(ordered(three(), order)).toEqual(["c", "a", "b"])
  })

  it("places a session below its target row and keeps the rest in order", () => {
    let order = written()
    order = rankSessionAt(order, ["a", "b", "c"], "a", "c", true)
    expect(ordered(three(), order)).toEqual(["b", "c", "a"])
  })

  it("lets a never-ordered session be positioned between two ordered ones", () => {
    let order = recordSessionUserInput("a", 2_000)
    order = recordSessionUserInput("b", 1_000)
    const chats = [chat("a", 0), chat("b", 0), chat("untouched", 10_000)]
    // Without a position an unranked session sorts after every ranked one, so
    // only an explicit drop can place it above `a`.
    expect(ordered(chats, order)).toEqual(["b", "a", "untouched"])
    order = rankSessionAt(order, ["a", "b", "untouched"], "untouched", "a", false)
    expect(ordered(chats, order)).toEqual(["untouched", "a", "b"])
  })

  it("keeps a later submission ahead of a manual position", () => {
    let order = recordSessionUserInput("a", 1_000)
    order = recordSessionUserInput("b", 2_000)
    order = rankSessionAt(order, ["b", "a"], "b", "a", true)
    expect(ordered([chat("a", 0), chat("b", 0)], order)).toEqual(["a", "b"])
    order = recordSessionUserInput("b", 3_000)
    expect(ordered([chat("a", 0), chat("b", 0)], order)).toEqual(["b", "a"])
  })

  it("ignores drops that cannot be positioned", () => {
    const order = recordSessionUserInput("a", 1_000)
    expect(rankSessionAt(order, ["a"], "a", "a")).toBe(order)
    expect(rankSessionAt(order, ["a"], "a", "missing")).toBe(order)
    expect(rankSessionAt(order, ["a"], "", "a")).toBe(order)
  })
})
