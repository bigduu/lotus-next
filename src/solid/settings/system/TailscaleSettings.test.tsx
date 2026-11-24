import { render } from "@solidjs/web"
import { createSignal, flush, Show } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { TailscaleAccessStatus } from "@services/config/SettingsService"
import i18n from "@shared/i18n/runtime"
import { TailscaleSettings } from "./TailscaleSettings"

const { getAccess, setAccess, openExternalLink } = vi.hoisted(() => ({
  getAccess: vi.fn<() => Promise<TailscaleAccessStatus>>(),
  setAccess: vi.fn<(action: string) => Promise<TailscaleAccessStatus>>(),
  openExternalLink: vi.fn<(url: string) => Promise<void>>(),
}))
vi.mock("@services/config/SettingsService", () => ({
  settingsService: { getTailscaleAccess: getAccess, setTailscaleAccess: setAccess },
}))
vi.mock("@/utils/environment", () => ({ isTauriEnvironment: () => true }))
vi.mock("@shared/utils/openExternalLink", () => ({ openExternalLink }))

const ready: TailscaleAccessStatus = {
  state: "ready", enabled: false, tailnet: "example.ts.net", url: null, action_url: null,
}
const address = "https://bamboo.example.ts.net/"
const login = "https://login.tailscale.com/a/fixture"
let host: HTMLDivElement
let dispose: () => void
let setRevision: (value: number) => void

async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve()
    flush()
  }
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  host = document.body.appendChild(document.createElement("div"))
  const [revision, update] = createSignal<number>()
  setRevision = update
  dispose = render(() => <Show when={revision() !== undefined}>
    <TailscaleSettings passwordRevision={revision()!} />
  </Show>, host)
})

afterEach(() => {
  dispose()
  host.remove()
  getAccess.mockReset()
  setAccess.mockReset()
  openExternalLink.mockReset()
})

it("opens the Tailscale sign-in link with the Bodhi shell", async () => {
  getAccess.mockResolvedValue({ ...ready, state: "login_required", action_url: login })
  openExternalLink.mockResolvedValue(undefined)
  await settle(() => setRevision(0))

  const link = document.querySelector<HTMLAnchorElement>(`a[href="${login}"]`)!
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  await settle(async () => { link.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(login)
})

it("keeps the share closed when an older password-refresh response arrives", async () => {
  const active: TailscaleAccessStatus = { ...ready, state: "active", enabled: true, url: address }
  let resolveRefresh: (status: TailscaleAccessStatus) => void = () => {}
  getAccess.mockResolvedValueOnce(active).mockReturnValueOnce(new Promise((resolve) => {
    resolveRefresh = resolve
  }))
  setAccess.mockResolvedValue(ready)
  await settle(() => setRevision(0))
  await settle(() => setRevision(1))

  const disable = [...document.querySelectorAll("button")].find((button) => button.textContent === "关闭远程访问")!
  await settle(async () => disable.click())
  expect(setAccess).toHaveBeenCalledExactlyOnceWith("disable")
  await settle(async () => resolveRefresh(active))
  expect(document.querySelector(`a[href="${address}"]`)).toBeNull()
})
