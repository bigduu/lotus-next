import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SettingsRetry } from "./SettingsRetry"

const roots: Root[] = []
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true

const getTypedSection = vi.fn()
const putTypedSection = vi.fn()

vi.mock("@services/config/SettingsService", () => ({
  settingsService: {
    getTypedSection: (...args: unknown[]) => getTypedSection(...args),
    putTypedSection: (...args: unknown[]) => putTypedSection(...args),
  },
}))

const policy = {
  max_attempts: 8,
  attempt_timeout_ms: 180_000,
  total_budget_ms: 900_000,
  base_delay_ms: 500,
  max_delay_ms: 30_000,
}

const envelope = (data: unknown, revision: number) => ({ data, revision })

async function mount(): Promise<HTMLElement> {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(<SettingsRetry />)
  })
  return host
}

const flush = () => act(async () => { await Promise.resolve() })

function field(host: HTMLElement, key: string): HTMLInputElement {
  const element = host.querySelector<HTMLInputElement>(`#llm-retry-${key}`)
  if (!element) throw new Error(`missing input ${key}`)
  return element
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

/** Buttons are localized, so match either the English or the Chinese label. */
function button(host: HTMLElement, kind: "save" | "reload"): HTMLButtonElement {
  const labels = kind === "save" ? ["save", "保存"] : ["reload", "重新加载"]
  const all = [...host.querySelectorAll("button")]
  const match = all.find((candidate) =>
    labels.some((label) => candidate.textContent?.toLowerCase().includes(label)),
  )
  if (!match) throw new Error(`missing ${kind} button; found: ${all.map((b) => b.textContent).join("|")}`)
  return match
}

describe("SettingsRetry", () => {
  beforeEach(() => {
    getTypedSection.mockReset()
    putTypedSection.mockReset()
    getTypedSection.mockResolvedValue(envelope({ llm_retry: policy }, 3))
  })

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount()
    })
    document.body.innerHTML = ""
  })

  it("loads the core section and renders the current policy", async () => {
    const host = await mount()
    await flush()
    expect(getTypedSection).toHaveBeenCalledWith("core")
    expect(field(host, "max_attempts").value).toBe("8")
    expect(field(host, "attempt_timeout_ms").value).toBe("180000")
  })

  it("writes only llm_retry back into the core section, keeping other keys", async () => {
    const unrelated = { server: { port: 9562 } }
    getTypedSection
      .mockResolvedValueOnce(envelope({ ...unrelated, llm_retry: policy }, 3))
      .mockResolvedValueOnce(envelope({ ...unrelated, llm_retry: policy }, 4))
    putTypedSection.mockResolvedValue(
      envelope({ ...unrelated, llm_retry: { ...policy, max_attempts: 10 } }, 5),
    )

    const host = await mount()
    await flush()
    await act(async () => {
      setValue(field(host, "max_attempts"), "10")
    })
    await act(async () => {
      button(host, "save").click()
    })
    await flush()

    expect(putTypedSection).toHaveBeenCalledTimes(1)
    const [, data, revision] = putTypedSection.mock.calls[0] as [string, Record<string, unknown>, number]
    // The CAS revision is the freshly re-read one, not the stale mount revision.
    expect(revision).toBe(4)
    expect(data).toEqual({ ...unrelated, llm_retry: { ...policy, max_attempts: 10 } })
  })

  it("refuses an out-of-range value without calling the server", async () => {
    const host = await mount()
    await flush()
    await act(async () => {
      setValue(field(host, "max_attempts"), "99")
    })
    await act(async () => {
      button(host, "save").click()
    })
    await flush()

    expect(putTypedSection).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("max_attempts")
  })

  it("keeps a concurrent edit to an untouched field instead of reverting it", async () => {
    // Another panel saved a new deadline after this panel loaded.
    const concurrent = { ...policy, attempt_timeout_ms: 240_000 }
    const unrelated = { server: { port: 9562 } }
    getTypedSection
      .mockResolvedValueOnce(envelope({ ...unrelated, llm_retry: policy }, 3))
      .mockResolvedValueOnce(envelope({ ...unrelated, llm_retry: concurrent }, 4))
    putTypedSection.mockResolvedValue(
      envelope({ ...unrelated, llm_retry: { ...concurrent, max_attempts: 10 } }, 5),
    )

    const host = await mount()
    await flush()
    await act(async () => {
      setValue(field(host, "max_attempts"), "10")
    })
    await act(async () => {
      button(host, "save").click()
    })
    await flush()

    expect(putTypedSection).toHaveBeenCalledTimes(1)
    const [, data] = putTypedSection.mock.calls[0] as [string, { llm_retry: Record<string, number> }]
    // The edited field is applied; the other panel's deadline survives.
    expect(data.llm_retry.max_attempts).toBe(10)
    expect(data.llm_retry.attempt_timeout_ms).toBe(240_000)
  })

  it("reports an unconfirmed save and reloads the current values", async () => {
    putTypedSection.mockRejectedValue(new Error("conflict"))

    const host = await mount()
    await flush()
    await act(async () => {
      button(host, "save").click()
    })
    await flush()

    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    // mount + pre-write re-read + post-failure reload
    expect(getTypedSection).toHaveBeenCalledTimes(3)
  })
})
