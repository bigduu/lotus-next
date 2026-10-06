import { beforeEach, describe, expect, it, vi } from "vitest"

const service = vi.hoisted(() => ({
  getProviderCatalog: vi.fn(),
  fetchCatalogModels: vi.fn(),
}))
vi.mock("../config/SettingsService", () => ({ settingsService: service }))

import { modelService } from "./ModelService"

describe("runtime model options", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reads only admitted catalog IDs and never triggers discovery", async () => {
    service.getProviderCatalog.mockResolvedValue({
      providers: [],
      models: [
        { reference: { provider: "work", model: "usable" } },
        { reference: { provider: "other", model: "custom-id" } },
        { reference: { provider: "other", model: "usable" } },
      ],
    })
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [{ provider: "work", models: [{ reference: { provider: "work", model: "unusable" } }] }],
    })

    await expect(modelService.getModels()).resolves.toEqual(["custom-id", "usable"])
    await expect(modelService.getModels("work")).resolves.toEqual(["usable"])
    expect(service.fetchCatalogModels).not.toHaveBeenCalled()
  })
})
