import { beforeEach, describe, expect, it } from "vitest"
import {
  PINNED_PROJECTS_STORAGE_KEY,
  readPinnedProjectIds,
  writePinnedProjectIds,
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
