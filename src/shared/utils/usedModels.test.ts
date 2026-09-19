import { beforeEach, describe, expect, it } from "vitest"
import {
  clearUsedModels,
  getUsedModels,
  recordUsedModel,
  removeUsedModel,
} from "./usedModels"

describe("used model registry", () => {
  beforeEach(() => clearUsedModels())

  it("keeps acknowledged models in most-recently-used order", () => {
    recordUsedModel("gpt-5")
    recordUsedModel("glm-5.3")
    recordUsedModel("  gpt-5  ")

    expect(getUsedModels()).toEqual(["gpt-5", "glm-5.3"])
  })

  it("removes one discovery entry without disturbing the others", () => {
    recordUsedModel("gpt-5")
    recordUsedModel("glm-5.3")

    expect(removeUsedModel("glm-5.3")).toEqual(["gpt-5"])
    expect(getUsedModels()).toEqual(["gpt-5"])
  })

  it("recovers from malformed legacy storage", () => {
    localStorage.setItem("zenith.usedModels.v1", "{bad json")

    expect(getUsedModels()).toEqual([])
    expect(recordUsedModel("claude-opus-4.1")).toEqual(["claude-opus-4.1"])
  })
})
