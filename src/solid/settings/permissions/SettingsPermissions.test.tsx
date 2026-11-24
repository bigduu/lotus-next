import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { uiText } from "@shared/i18n/text"
import { SettingsPermissions } from "./SettingsPermissions"

const modePath = "/bamboo/permission/default-session-mode"
const handoffPath = "/bamboo/permission/supervisor-handoff"
// The fixture observes endpoint identity, receipts, and rendered state.
vi.mock("@lucide/solid", () => ({ Plus: () => null, Trash2: () => null }))

async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve()
    flush()
  }
}

const cleanups: Array<() => void> = []

async function mount() {
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => <SettingsPermissions ownerAccess />, host)
  cleanups.push(() => { dispose(); host.remove() })
  await settle(() => {})
  return host
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
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
  await settle(async () => toggle.click())

  expect(put).toHaveBeenCalledExactlyOnceWith(handoffPath, { enabled: true, expected_revision: 7 })
  expect(get.mock.calls.filter(([path]) => path === modePath)).toEqual([
    [modePath, { cache: "no-store" }], [modePath, { cache: "no-store" }],
  ])
  await vi.waitFor(() => {
    flush()
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toBe(uiText("the_request_or_permissions_have_changed_confirm_again_u_a1ebae48"))
  })

  await settle(async () => toggle.click())
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
