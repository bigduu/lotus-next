import { describe, expect, it } from "vitest"
import { reorderVisibleWorkbenchTabIds } from "./workbenchTabs"

describe("reorderVisibleWorkbenchTabIds", () => {
  it("keeps hidden browser tabs in their saved positions while tools are reordered", () => {
    expect(reorderVisibleWorkbenchTabIds(
      ["browser:first", "tool:inspector", "browser:second", "tool:review"],
      ["tool:review", "tool:inspector"],
    )).toEqual(["browser:first", "tool:review", "browser:second", "tool:inspector"])
  })

  it("includes newly opened visible tabs without dropping hidden tabs", () => {
    expect(reorderVisibleWorkbenchTabIds(
      ["browser:first", "tool:inspector"],
      ["tool:review", "tool:inspector"],
    )).toEqual(["browser:first", "tool:review", "tool:inspector"])
  })
})
