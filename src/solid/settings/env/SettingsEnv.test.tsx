import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiClient, ApiError } from "@services/api"
import { SettingsEnv } from "./SettingsEnv"

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

// The switch primitive itself is exercised by the built Settings and plugin suites.
vi.mock("../../ui/switch", () => ({
  Switch: (props: { id: string; checked: boolean; disabled?: boolean; onCheckedChange: (value: boolean) => void }) =>
    <input type="checkbox" id={props.id} role="switch" checked={props.checked} disabled={props.disabled}
      onChange={(event) => props.onCheckedChange(event.currentTarget.checked)} />,
}))

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()

const snapshot = (revision: number, entries: unknown[] = []) => ({ revision, entries })

async function mount() {
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => <SettingsEnv />, host)
  cleanups.push(() => { dispose(); host.remove() })
  await settle(() => {})
}

async function fill(placeholder: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
  expect(input).not.toBeNull()
  await settle(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input!.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  )!

beforeEach(() => {
  get.mockReset().mockResolvedValue(snapshot(7))
  post.mockReset()
  del.mockReset()
  vi.spyOn(apiClient, "get").mockImplementation(get)
  vi.spyOn(apiClient, "post").mockImplementation(post)
  vi.spyOn(apiClient, "delete").mockImplementation(del)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})

describe("SettingsEnv", () => {
  it("binds a new secret to the loaded revision and applies the returned snapshot", async () => {
    post.mockResolvedValue(
      snapshot(8, [{ name: "JEV_API_KEY", secret: true, has_value: true }]),
    )
    await mount()
    await fill("名称(如 OPENAI_API_KEY)", " JEV_API_KEY ")
    await fill("值", "private-value")
    await settle(async () => {
      document.querySelector<HTMLInputElement>('[role="switch"]')!.click()
    })
    await settle(async () => {
      button("添加").click()
    })

    expect(post).toHaveBeenCalledExactlyOnceWith("/bamboo/env-vars", {
      expected_revision: 7,
      name: "JEV_API_KEY",
      value: "private-value",
      secret: true,
    })
    expect(document.body.textContent).toContain("已配置 (1)")
    expect(document.body.textContent).toContain("已设置（值已隐藏）")
    expect(document.body.textContent).not.toContain("private-value")
  })

  it("binds deletion to the latest returned revision", async () => {
    get.mockResolvedValue(
      snapshot(11, [{ name: "OLD_VALUE", value: "plain", secret: false, has_value: true }]),
    )
    del.mockResolvedValue(snapshot(12))
    await mount()
    await settle(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="删除 OLD_VALUE"]')!.click()
    })

    expect(del).toHaveBeenCalledExactlyOnceWith(
      "/bamboo/env-vars/OLD_VALUE?expected_revision=11",
    )
    expect(document.body.textContent).toContain("已配置 (0)")
  })

  it("surfaces a safe error, refreshes authority and preserves the draft after rejection", async () => {
    post.mockRejectedValue(
      new ApiError("PRIVATE_BACKEND_MARKER", 409, "Conflict", "PRIVATE_BACKEND_MARKER"),
    )
    get.mockResolvedValueOnce(snapshot(3)).mockResolvedValueOnce(snapshot(4))
    await mount()
    await fill("名称(如 OPENAI_API_KEY)", "RETRY_ME")
    await fill("值", "PRIVATE_DRAFT_MARKER")
    await settle(async () => {
      button("添加").click()
    })

    expect(get).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => {
      flush()
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("已刷新实际列表")
    })
    expect(document.body.textContent).not.toContain("PRIVATE_BACKEND_MARKER")
    expect(document.querySelector<HTMLInputElement>('input[placeholder="值"]')?.value).toBe(
      "PRIVATE_DRAFT_MARKER",
    )
  })
})
