import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { type PublisherPolicy, type PublisherPolicyChange } from "@services/plugin"
import { changeLocale } from "@shared/i18n"
import { PublisherTrustPanel } from "./PublisherTrustPanel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let policy: PublisherPolicy
const get = vi.fn()
const post = vi.fn()
const end = vi.fn()
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === name)!
const click = async (name: string) => act(async () => { button(name).click() })
const namedClick = async (name: string) => act(async () => { document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click() })
async function mount() {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => { root!.render(<PublisherTrustPanel disabled={false} onBegin={() => true} onEnd={end} />) })
  if (button("发布者信任")) await click("发布者信任")
}
const apply = (change: PublisherPolicyChange) => {
  policy.expected_revision += 1
  if (change.type === "set_mode") policy.publisher_mode = change.publisher_mode
  else {
    const publisher = policy.publishers.find(({ id }) => id === change.publisher_id)!
    publisher.trusted = change.type === "trust"
    publisher.revoked = change.type === "revoke"
  }
}

beforeEach(async () => {
  await changeLocale("zh-CN")
  policy = { expected_revision: 7, publisher_mode: "follow_defaults", enforcement: "strict", custom_key_count: 1,
    publishers: ["jiandu", "nova", "magpie"].map((id, index) => ({ id, key: { label: `${id} (bigduu official)`, algorithm: "ed25519", public_key: ["ab", "cd", "ef"][index]!.repeat(32) }, trusted: true, revoked: false })) }
  get.mockReset().mockImplementation(async () => structuredClone(policy))
  post.mockReset().mockImplementation(async (_path, body) => { apply(body.change) })
  end.mockReset().mockResolvedValue(undefined)
  vi.spyOn(apiClient, "get").mockImplementation(get)
  vi.spyOn(apiClient, "post").mockImplementation(post)
})
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it("reviews the exact key and cancels without a mutation", async () => {
  await mount()
  await namedClick("撤销 jiandu 发布者信任")
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ab".repeat(32))
  await click("取消")
  expect(post).not.toHaveBeenCalled()
})

it("preserves revoked status and custom keys across reviewed mode changes and restoration", async () => {
  await mount()
  await namedClick("撤销 jiandu 发布者信任")
  await click("确认策略更改")
  expect(document.body.textContent).toContain("已撤销")
  await click("使用自定义信任列表")
  await click("确认策略更改")
  expect(document.body.textContent).toContain("已撤销")
  await click("跟随官方默认")
  await click("确认策略更改")
  expect(document.body.textContent).toContain("已撤销")
  expect(document.body.textContent).toContain("保留的自定义公钥：1")
  await namedClick("信任 jiandu 发布者")
  await click("确认策略更改")
  expect(document.body.textContent).not.toContain("已撤销")
  expect(post).toHaveBeenCalledTimes(4)
  expect(post.mock.calls.map(([, body]) => body.expected_revision)).toEqual([7, 8, 9, 10])
  expect(end).toHaveBeenCalledTimes(4)
})

it("keeps the reviewed revision on conflict and requires a new explicit review", async () => {
  await mount()
  await namedClick("撤销 jiandu 发布者信任")
  policy.expected_revision = 8
  post.mockRejectedValue(new ApiError("changed", 409, "Conflict"))
  await click("确认策略更改")
  expect(post.mock.calls[0]![1].expected_revision).toBe(7)
  expect(document.body.textContent).toContain("策略在确认后已变化")
  await click("刷新发布者策略")
  expect(post).toHaveBeenCalledTimes(1)
})

it("reconciles a lost response from a later GET without repeating the POST", async () => {
  await mount()
  await namedClick("撤销 jiandu 发布者信任")
  post.mockImplementation(async (_path, body) => { apply(body.change); get.mockRejectedValue(new Error("offline")); throw new Error("response lost") })
  await click("确认策略更改")
  expect(document.body.textContent).toContain("尚无法确认更改结果")
  get.mockImplementation(async () => structuredClone(policy))
  await click("刷新发布者策略")
  expect(document.body.textContent).toContain("已撤销")
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(post).toHaveBeenCalledTimes(1)
})

it("does not accept a successful mutation response without fresh matching policy", async () => {
  post.mockResolvedValue(undefined)
  await mount()
  await namedClick("撤销 jiandu 发布者信任")
  await click("确认策略更改")
  expect(document.body.textContent).toContain("尚无法确认更改结果")
  expect(post).toHaveBeenCalledTimes(1)
})

it("withholds controls on an older server without policy capability", async () => {
  get.mockRejectedValue(new ApiError("missing", 404, "Not Found"))
  await mount()
  expect(document.body.textContent).toBe("")
  expect(post).not.toHaveBeenCalled()
})
