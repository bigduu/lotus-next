import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { TailscaleAccessStatus } from "@services/config/SettingsService"
import i18n from "@shared/i18n"
import { SectionTailscale } from "./SectionTailscale"

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

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const ready: TailscaleAccessStatus = {
  state: "ready", enabled: false, tailnet: "example.ts.net", url: null, action_url: null,
}
const address = "https://bamboo.example.ts.net/"
const login = "https://login.tailscale.com/a/fixture"
let root: Root

beforeEach(async () => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage("zh-CN")
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  Reflect.deleteProperty(environment, "IS_REACT_ACT_ENVIRONMENT")
  getAccess.mockReset()
  setAccess.mockReset()
  openExternalLink.mockReset()
})

it("opens the Tailscale sign-in link with the Bodhi shell", async () => {
  getAccess.mockResolvedValue({ ...ready, state: "login_required", action_url: login })
  openExternalLink.mockResolvedValue(undefined)
  await act(async () => root.render(<SectionTailscale passwordRevision={0} />))

  const link = document.querySelector<HTMLAnchorElement>(`a[href="${login}"]`)!
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  await act(async () => { link.dispatchEvent(event) })
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
  await act(async () => root.render(<SectionTailscale passwordRevision={0} />))
  await act(async () => root.render(<SectionTailscale passwordRevision={1} />))

  const disable = [...document.querySelectorAll("button")].find((button) => button.textContent === "关闭远程访问")!
  await act(async () => disable.click())
  expect(setAccess).toHaveBeenCalledExactlyOnceWith("disable")
  await act(async () => resolveRefresh(active))
  expect(document.querySelector(`a[href="${address}"]`)).toBeNull()
})
