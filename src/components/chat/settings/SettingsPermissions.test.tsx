import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { uiText } from "@shared/i18n/ui"
import { SettingsPermissions } from "./SettingsPermissions"

const modePath = "/bamboo/permission/default-session-mode"
const handoffPath = "/bamboo/permission/supervisor-handoff"
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | undefined

async function mount() {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  await act(async () => root?.render(<SettingsPermissions />))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  delete environment.IS_REACT_ACT_ENVIRONMENT
  vi.restoreAllMocks()
})

it("reloads the handoff policy on a revision conflict and waits for another decision", async () => {
  const initial = { mode: "default", revision: 7, supervisor_approval_handoff_enabled: false }
  const current = { mode: "default", revision: 8, supervisor_approval_handoff_enabled: true }
  const policies = [initial, current]
  const get = vi.spyOn(apiClient, "get").mockImplementation(vi.fn(async (path: string) =>
    path === modePath ? policies.shift() : { rules: [] },
  ))
  const put = vi.spyOn(apiClient, "put")
    .mockRejectedValueOnce(new ApiError("Policy changed", 409, "Conflict"))
    .mockResolvedValueOnce({ ...current, revision: 9, supervisor_approval_handoff_enabled: false })

  const host = await mount()
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-pressed]')!
  expect(toggle.getAttribute("aria-pressed")).toBe("false")
  await act(async () => toggle.click())

  expect(put).toHaveBeenCalledExactlyOnceWith(handoffPath, { enabled: true, expected_revision: 7 })
  expect(get.mock.calls.filter(([path]) => path === modePath)).toEqual([
    [modePath, { cache: "no-store" }], [modePath, { cache: "no-store" }],
  ])
  expect(toggle.getAttribute("aria-pressed")).toBe("true")
  expect(host.querySelector('[role="alert"]')?.textContent)
    .toBe(uiText("the_request_or_permissions_have_changed_confirm_again_u_a1ebae48"))

  await act(async () => toggle.click())
  expect(put).toHaveBeenNthCalledWith(2, handoffPath, { enabled: false, expected_revision: 8 })
  expect(toggle.getAttribute("aria-pressed")).toBe("false")
})

it("keeps the default mode available when an older host omits the handoff policy", async () => {
  vi.spyOn(apiClient, "get").mockImplementation(vi.fn(async (path: string) =>
    path === modePath ? { mode: "default", revision: 7 } : { rules: [] },
  ))
  const host = await mount()
  expect(host.querySelector("button[aria-pressed]")).toBeNull()
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Default")?.disabled).toBe(false)
})
