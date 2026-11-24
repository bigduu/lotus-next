import { render, type JSX } from "@solidjs/web"
import { createContext, createSignal, flush, Show, useContext } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AssistantMarkdown } from "../markdown/AssistantMarkdown"
import { ExternalLinkDialog } from "./ExternalLinkDialog"

const { copyText, openExternalLink } = vi.hoisted(() => ({
  copyText: vi.fn<(text: string) => Promise<void>>(),
  openExternalLink: vi.fn<(url: string) => Promise<void>>(),
}))
vi.mock("@shared/utils/clipboard", () => ({ copyText }))
vi.mock("@shared/utils/openExternalLink", () => ({ openExternalLink }))
// The built browser suite exercises the Kobalte portal and keyboard behavior.
// This jsdom fixture uses DOM surfaces for the action/callback checks.
vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { ChevronDown: Icon, Copy: Icon, ExternalLink: Icon, Globe2: Icon }
})
vi.mock("../ui/responsive-dialog", () => ({
  ResponsiveDialog: (props: { children?: JSX.Element }) => <>{props.children}</>,
  ResponsiveDialogContent: (props: { children?: JSX.Element; "data-streamdown"?: string }) =>
    <section role="dialog" data-streamdown={props["data-streamdown"]}>{props.children}</section>,
  ResponsiveDialogTitle: (props: { children?: JSX.Element }) => <h2>{props.children}</h2>,
  ResponsiveDialogDescription: (props: { children?: JSX.Element }) => <p>{props.children}</p>,
}))
vi.mock("../ui/dropdown-menu", () => {
  const Menu = createContext<{ open: () => boolean; show: () => void }>()
  return {
    DropdownMenu: (props: { children?: JSX.Element }) => {
      const [open, setOpen] = createSignal(false)
      return <Menu value={{ open, show: () => setOpen(true) }}>{props.children}</Menu>
    },
    DropdownMenuTrigger: (props: { children?: JSX.Element; disabled?: boolean }) =>
      <button type="button" disabled={props.disabled} onClick={useContext(Menu).show}>{props.children}</button>,
    DropdownMenuContent: (props: { children?: JSX.Element }) =>
      <Show when={useContext(Menu).open()}><div role="menu">{props.children}</div></Show>,
    DropdownMenuItem: (props: { children?: JSX.Element; onSelect?: () => void }) =>
      <button type="button" role="menuitem" onClick={props.onSelect}>{props.children}</button>,
  }
})

const url = "https://example.com/readme"
const dialog = '[data-streamdown="link-safety-modal"]'
const mounted: (() => void)[] = []

beforeEach(() => {
  copyText.mockReset().mockResolvedValue(undefined)
  openExternalLink.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  for (const cleanup of mounted.splice(0)) cleanup()
})

function button(label: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>(`${dialog} button`)]
    .find((item) => item.textContent?.trim() === label)
  if (!element) throw new Error(`Missing button ${label}`)
  return element
}

const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
async function waitFor(assert: () => void) {
  await vi.waitFor(() => { flush(); assert() })
}

async function openMenu() {
  button("打开链接").click()
  await waitFor(() => expect(menuItems().length).toBeGreaterThan(0))
}

function select(label: string) {
  const item = menuItems().find((item) => item.textContent?.trim() === label)
  if (!item) throw new Error(`Missing menu item ${label}`)
  item.click()
  flush()
}

async function mount(onOpenInApp?: (url: string) => Promise<void>, source = url) {
  const host = document.body.appendChild(document.createElement("div"))
  const [link, setLink] = createSignal<string>()
  const unmount = render(() => <>
    <AssistantMarkdown onOpenLink={(target) => setLink(target)}>{`[Read this](${source})`}</AssistantMarkdown>
    <Show when={link()}>{(target) => (
      <ExternalLinkDialog url={target()} onOpenInApp={onOpenInApp} onClose={() => setLink(undefined)} />
    )}</Show>
  </>, host)
  mounted.push(() => { unmount(); host.remove() })
  flush()
  host.querySelector<HTMLAnchorElement>('[data-streamdown="link"]')!.click()
  await waitFor(() => expect(document.querySelector(dialog)?.textContent).toContain(source))
}

it("opens the same Markdown URL in the app browser and closes the dialog", async () => {
  const openInApp = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  await mount(openInApp)
  await openMenu()
  select("在应用内打开")
  await waitFor(() => expect(document.querySelector(dialog)).toBeNull())
  expect(openInApp).toHaveBeenCalledExactlyOnceWith(url)
  expect(openExternalLink).not.toHaveBeenCalled()
})

it("uses the default browser action without calling window.open", async () => {
  const popup = vi.spyOn(window, "open").mockImplementation(() => null)
  await mount(vi.fn().mockResolvedValue(undefined))
  await openMenu()
  select("使用默认浏览器打开")
  await waitFor(() => expect(document.querySelector(dialog)).toBeNull())
  expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(url)
  expect(popup).not.toHaveBeenCalled()
})

it("copies the exact URL and then closes the dialog", async () => {
  await mount()
  button("复制链接").click()
  await waitFor(() => expect(document.querySelector(dialog)).toBeNull())
  expect(copyText).toHaveBeenCalledExactlyOnceWith(url)
})

it("offers only the default browser when the app browser is unavailable", async () => {
  await mount()
  await openMenu()
  expect(menuItems().map((item) => item.textContent?.trim())).toEqual(["使用默认浏览器打开"])
})

it("routes mailto URLs only to the default handler", async () => {
  const address = "mailto:user@example.com"
  const openInApp = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  await mount(openInApp, address)
  await openMenu()
  expect(menuItems().map((item) => item.textContent?.trim())).toEqual(["使用默认浏览器打开"])
  select("使用默认浏览器打开")
  await waitFor(() => expect(document.querySelector(dialog)).toBeNull())
  expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(address)
  expect(openInApp).not.toHaveBeenCalled()
})

it("keeps the dialog open and reports a failed default browser action", async () => {
  openExternalLink.mockRejectedValueOnce(new Error("shell unavailable"))
  await mount()
  await openMenu()
  select("使用默认浏览器打开")
  await waitFor(() => expect(document.querySelector(`${dialog} [role="alert"]`)?.textContent).toContain("无法使用默认浏览器打开"))
  expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(url)
})
