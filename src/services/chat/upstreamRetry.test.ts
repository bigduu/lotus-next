import { beforeEach, expect, it, vi } from "vitest"
const get = vi.hoisted(() => vi.fn())
vi.mock("@services/api", () => ({ apiClient: { get } }))
import { supportsContinuousUpstreamRetry, readUpstreamRetryCapability, isRetryRunId } from "./upstreamRetry"
beforeEach(() => get.mockReset())
it.each([null, {}, {upstream_retry:null}, {upstream_retry:{supported_modes:["bounded"]}},
  {upstream_retry:{supported_modes:"until_cancelled"}}, {upstream_retry:{supported_modes:[true]}}])("fails closed for unsupported capability %j", async (value) => {
  get.mockResolvedValue(value)
  expect(await supportsContinuousUpstreamRetry()).toBe(false)
})
it("freshly negotiates the explicit supported mode without caching configuration", async () => {
  get.mockResolvedValueOnce({ upstream_retry:{supported_modes:["bounded","until_cancelled"],max_attempts:6} }).mockResolvedValueOnce({})
  expect(await supportsContinuousUpstreamRetry()).toBe(true)
  expect(await supportsContinuousUpstreamRetry()).toBe(false)
  expect(get).toHaveBeenNthCalledWith(1,"execute/defaults",{cache:"no-store"})
  expect(get).toHaveBeenCalledTimes(2)
})
it.each([undefined,null,"","bad\nrun","a".repeat(129),"含中文"])("rejects unsafe run identity %j", (v) => expect(isRetryRunId(v)).toBe(false))
it("accepts the bounded exact opaque execution identity", () => expect(isRetryRunId("run-1:exact")).toBe(true))

it("distinguishes valid legacy, unsupported, malformed and unavailable responses", async () => {
  get.mockResolvedValueOnce({ model:null, system_prompt:"", base_system_prompt:"", default_session_permission_mode:"default" })
    .mockResolvedValueOnce({ model:null, system_prompt:"", base_system_prompt:"" })
    .mockResolvedValueOnce({ upstream_retry:{supported_modes:["bounded"]} })
    .mockResolvedValueOnce({ upstream_retry:{supported_modes:"until_cancelled"} })
    .mockResolvedValueOnce({ upstream_retry:{supported_modes:["bounded",true]} })
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("network"))
  expect(await readUpstreamRetryCapability()).toBe("unsupported")
  expect(await readUpstreamRetryCapability()).toBe("unsupported")
  expect(await readUpstreamRetryCapability()).toBe("unsupported")
  expect(await readUpstreamRetryCapability()).toBe("unknown")
  expect(await readUpstreamRetryCapability()).toBe("unknown")
  expect(await readUpstreamRetryCapability()).toBe("unknown")
  expect(await readUpstreamRetryCapability()).toBe("unknown")
})
