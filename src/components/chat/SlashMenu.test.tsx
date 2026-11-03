import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SlashMenu } from "./SlashMenu"

vi.mock("./useMenuKeyboardNav", () => ({ useMenuKeyboardNav: () => 0 }))
const roots: Root[] = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
HTMLElement.prototype.scrollIntoView = vi.fn()

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

async function mount(query: string, onPickCatalog: () => void, onPickGoal?: () => void,
  compact: { action?: () => void; unavailable?: string } = {}) {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  const onPickWorkflow = vi.fn()
  await act(async () => root.render(<SlashMenu inputId="composer" skills={[]} workflows={[]} query={query}
    onPick={vi.fn()} onPickWorkflow={onPickWorkflow} onPickCatalog={onPickCatalog} onPickGoal={onPickGoal}
    onPickCompact={compact.action} compactUnavailable={compact.unavailable} />))
  return { onPickWorkflow }
}

describe("slash menu catalog entry", () => {
  it("opens the directory on demand instead of expanding a text workflow", async () => {
    const open = vi.fn()
    const { onPickWorkflow } = await mount("workflow", open)
    const button = document.querySelector<HTMLButtonElement>("button")!
    expect(button.textContent).toContain("目录工作流")
    expect(button.textContent).toContain("目录选择")
    await act(async () => button.click())
    expect(open).toHaveBeenCalledOnce()
    expect(onPickWorkflow).not.toHaveBeenCalled()
  })

  it("keeps the existing command first for an empty slash query", async () => {
    const goal = vi.fn()
    await mount("", vi.fn(), goal)
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")]
    expect(buttons[0].textContent).toContain("/goal")
    expect(buttons[1].textContent).toContain("/目录工作流")
    await act(async () => buttons[0].click())
    expect(goal).toHaveBeenCalledOnce()
  })
})

it("selects the compact command directly from its name", async () => {
  const action = vi.fn()
  const { onPickWorkflow } = await mount("comp", vi.fn(), undefined, { action })
  const button = document.querySelector<HTMLButtonElement>("button")!
  expect(button.textContent).toContain("/compact")
  expect(button.textContent).toContain("压缩当前会话的上下文")
  await act(async () => button.click())
  expect(action).toHaveBeenCalledOnce()
  expect(onPickWorkflow).not.toHaveBeenCalled()
})

it("gives a disabled exact compact entry without invoking the command", async () => {
  const action = vi.fn()
  await mount("compact", vi.fn(), undefined, { action, unavailable: "session is busy" })
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")]
  expect(buttons).toHaveLength(1)
  expect(buttons[0].disabled).toBe(true)
  expect(buttons[0].textContent).toContain("session is busy")
  await act(async () => buttons[0].click())
  expect(action).not.toHaveBeenCalled()
})
