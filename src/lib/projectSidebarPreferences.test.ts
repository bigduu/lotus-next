import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  PINNED_PROJECTS_STORAGE_KEY,
  readPinnedProjectIds,
  writePinnedProjectIds,
  PROJECT_SECTIONS_STORAGE_KEY, readProjectSectionPreferences, writeProjectSectionPreferences,
  getProjectSections, getSessionSection, createProjectSection, removeProjectSection, setSessionSection,
} from "./projectSidebarPreferences"

describe("project sidebar pin preference", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips unique project ids in user order", () => {
    writePinnedProjectIds(new Set(["project-b", "project-a"]))
    expect([...readPinnedProjectIds()]).toEqual(["project-b", "project-a"])
  })

  it("ignores corrupt and malformed stored values", () => {
    localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, "not-json")
    expect([...readPinnedProjectIds()]).toEqual([])
    localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(["project-a", 3, "", "project-a"]))
    expect([...readPinnedProjectIds()]).toEqual(["project-a"])
  })
})

describe("device project section preference", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it("creates empty sections without assigning existing or future sessions", () => {
    const original = readProjectSectionPreferences()
    expect(getProjectSections(original, "a", "lotus")).toEqual([{ id: "legacy", name: "lotus" }])
    expect(getSessionSection(original, "a", "existing", "lotus")).toBeNull()
    const preferences = createProjectSection(original, "a", "Research", "lotus")
    expect(preferences.projects.a?.sessionSections).toEqual({})
    expect(getSessionSection(preferences, "a", "existing", "lotus")).toBeNull()
    expect(getSessionSection(preferences, "a", "future", "lotus")).toBeNull()
    writeProjectSectionPreferences(preferences)
    expect(getSessionSection(readProjectSectionPreferences(), "a", "existing", "lotus")).toBeNull()
    expect(getSessionSection(readProjectSectionPreferences(), "a", "future", "lotus")).toBeNull()
  })

  it("round-trips only explicit project-scoped assignments, including the legacy section", () => {
    let preferences = readProjectSectionPreferences()
    preferences = createProjectSection(preferences, "a", " lotus ", "Development")
    preferences = createProjectSection(preferences, "b", "lotus", "Development")
    const sectionA = getProjectSections(preferences, "a", "Development")[1]!
    const sectionB = getProjectSections(preferences, "b", "Development")[1]!
    expect(sectionA.name).toBe("lotus")
    expect(sectionA.id).not.toBe(sectionB.id)
    preferences = setSessionSection(preferences, "a", "assigned", sectionA.id, "Development")
    preferences = setSessionSection(preferences, "a", "legacy-assigned", "legacy", "Development")
    preferences = setSessionSection(preferences, "a", "unsectioned", null, "Development")
    writeProjectSectionPreferences(preferences)
    const restored = readProjectSectionPreferences()
    expect(getSessionSection(restored, "a", "default", "Development")).toBeNull()
    expect(getSessionSection(restored, "a", "assigned", "Development")).toBe(sectionA.id)
    expect(getSessionSection(restored, "a", "legacy-assigned", "Development")).toBe("legacy")
    expect(getSessionSection(restored, "a", "unsectioned", "Development")).toBeNull()
    expect(getSessionSection(restored, "b", "assigned", "Development")).toBeNull()
    expect(setSessionSection(restored, "b", "assigned", sectionA.id, "Development")).toBe(restored)
  })

  it("removes local and legacy sections without resurrecting their session assignments", () => {
    let preferences = createProjectSection(readProjectSectionPreferences(), "a", "lotus", "Development")
    const local = getProjectSections(preferences, "a", "Development")[1]!
    preferences = setSessionSection(preferences, "a", "session", local.id, "Development")
    preferences = removeProjectSection(preferences, "a", local.id, "Development")
    expect(getSessionSection(preferences, "a", "session", "Development")).toBeNull()
    preferences = setSessionSection(preferences, "a", "legacy-session", "legacy", "Development")
    preferences = removeProjectSection(preferences, "a", "legacy", "Development")
    writeProjectSectionPreferences(preferences)
    expect(getProjectSections(readProjectSectionPreferences(), "a", "Development")).toEqual([])
    expect(getSessionSection(readProjectSectionPreferences(), "a", "default", "Development")).toBeNull()
    expect(getSessionSection(readProjectSectionPreferences(), "a", "legacy-session", "Development")).toBeNull()
    expect(getProjectSections(preferences, "b", "Development")).toEqual([{ id: "legacy", name: "Development" }])
  })

  it("rejects corrupt storage, malformed tombstones, unknown targets and invalid or duplicate names", () => {
    localStorage.setItem(PROJECT_SECTIONS_STORAGE_KEY, "not-json")
    expect(getProjectSections(readProjectSectionPreferences(), "a", "Development")).toHaveLength(1)
    localStorage.setItem(PROJECT_SECTIONS_STORAGE_KEY, JSON.stringify({ version: 1, projects: {
      a: { sections: "invalid", sessionSections: {}, hiddenLegacy: true },
      b: { sections: [{ id: 3, name: "invalid" }], sessionSections: { bad: "missing" }, hiddenLegacy: true },
    } }))
    const preferences = readProjectSectionPreferences()
    expect(getSessionSection(preferences, "a", "session", "Development")).toBeNull()
    expect(getSessionSection(preferences, "b", "bad", "Development")).toBeNull()
    expect(getProjectSections(preferences, "a", "Development")).toEqual([{ id: "legacy", name: "Development" }])
    expect(getProjectSections(preferences, "b", "Development")).toEqual([{ id: "legacy", name: "Development" }])
    expect(createProjectSection(preferences, "a", "development", "Development")).toBe(preferences)
    expect(createProjectSection(preferences, "a", "莲".repeat(81))).toBe(preferences)
    expect(createProjectSection(preferences, "a", "bad\nname")).toBe(preferences)
    expect(setSessionSection(preferences, "a", "session", "missing")).toBe(preferences)
  })

  it("isolates prototype-like identifiers and leaves existing pin data untouched", () => {
    writePinnedProjectIds(new Set(["pinned"]))
    let preferences = createProjectSection(readProjectSectionPreferences(), "__proto__", "lotus")
    const section = getProjectSections(preferences, "__proto__")[0]!
    preferences = setSessionSection(preferences, "__proto__", "constructor", section.id)
    writeProjectSectionPreferences(preferences)
    const restored = readProjectSectionPreferences()
    expect(getSessionSection(restored, "__proto__", "constructor")).toBe(section.id)
    expect(getProjectSections(restored, "constructor")).toEqual([])
    expect([...readPinnedProjectIds()]).toEqual(["pinned"])
  })

  it("tolerates blocked storage while operations remain usable in caller state", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    let preferences = createProjectSection(readProjectSectionPreferences(), "a", "lotus", "Development")
    const section = getProjectSections(preferences, "a", "Development")[1]!
    preferences = setSessionSection(preferences, "a", "session", section.id, "Development")
    expect(() => writeProjectSectionPreferences(preferences)).not.toThrow()
    expect(getSessionSection(preferences, "a", "session", "Development")).toBe(section.id)
  })
})
