import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { copyText, openExternalLink } = vi.hoisted(() => ({
  copyText: vi.fn<(text: string) => Promise<void>>(),
  openExternalLink: vi.fn<(url: string) => Promise<void>>(),
}))

vi.mock("@shared/utils/clipboard", () => ({ copyText }))
vi.mock("@shared/utils/openExternalLink", () => ({ openExternalLink }))

import { StreamdownMarkdown } from "./StreamdownMarkdown"
import { ExternalLinkProvider } from "./ExternalLinkDialog"

const URL = "https://example.com/readme"
const roots: Root[] = []
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent?.trim() === label)
  if (!found) throw new Error(`Button ${label} is missing`)
  return found
}

const menuItem = (label: string) => {
  const found = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.trim() === label)
  if (!found) throw new Error(`Menu item ${label} is missing`)
  return found
}

const click = async (element: HTMLElement) => {
  await act(async () => { element.click(); await Promise.resolve() })
}

const openMenu = async () => {
  await act(async () => {
    button("打开链接").dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerType: "mouse",
    }))
    await Promise.resolve()
  })
}

async function mount(onOpenInApp?: (url: string) => Promise<void>, url = URL) {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <ExternalLinkProvider onOpenInApp={onOpenInApp}>
        <StreamdownMarkdown isStreaming={false}>{`[Read this](${url})`}</StreamdownMarkdown>
      </ExternalLinkProvider>,
    )
  })
  const link = container.querySelector<HTMLButtonElement>('[data-streamdown="link"]')
  if (!link) throw new Error("Rendered Markdown link is missing")
  await click(link)
  expect(document.querySelector('[data-streamdown="link-safety-modal"]')).not.toBeNull()
}

beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  copyText.mockReset().mockResolvedValue(undefined)
  openExternalLink.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

describe("assistant Markdown external links", () => {
  it("opens a selected link in the app browser and closes the dialog", async () => {
    const openInApp = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
    await mount(openInApp)

    await openMenu()
    await click(menuItem("在应用内打开"))

    expect(openInApp).toHaveBeenCalledExactlyOnceWith(URL)
    expect(openExternalLink).not.toHaveBeenCalled()
    expect(document.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull()
  })

  it("uses the system browser action without window.open", async () => {
    const popup = vi.spyOn(window, "open")
    await mount(vi.fn().mockResolvedValue(undefined))

    await openMenu()
    await click(menuItem("使用默认浏览器打开"))

    expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(URL)
    expect(popup).not.toHaveBeenCalled()
    expect(document.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull()
  })

  it("closes after copying the link", async () => {
    await mount()

    await click(button("复制链接"))

    expect(copyText).toHaveBeenCalledExactlyOnceWith(URL)
    expect(document.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull()
  })

  it("offers only the default browser when the app browser is unavailable", async () => {
    await mount()

    await openMenu()

    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain("使用默认浏览器打开")
    expect([...document.querySelectorAll('[role="menuitem"]')]).toHaveLength(1)
  })

  it("routes mailto links only to the user's default handler", async () => {
    const address = "mailto:user@example.com"
    const openInApp = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
    await mount(openInApp, address)

    await openMenu()
    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim()))
      .toEqual(["使用默认浏览器打开"])
    await click(menuItem("使用默认浏览器打开"))

    expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(address)
    expect(openInApp).not.toHaveBeenCalled()
    expect(document.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull()
  })

  it("keeps the dialog open and reports a failed default-browser open", async () => {
    openExternalLink.mockRejectedValueOnce(new Error("shell unavailable"))
    await mount()

    await openMenu()
    await click(menuItem("使用默认浏览器打开"))

    expect(document.querySelector('[data-streamdown="link-safety-modal"]')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("无法使用默认浏览器打开")
  })
})
