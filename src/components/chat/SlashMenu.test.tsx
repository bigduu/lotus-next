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

async function mount(query: string, onPickCatalog: () => void, onPickGoal?: () => void) {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  const onPickWorkflow = vi.fn()
  await act(async () => root.render(<SlashMenu inputId="composer" skills={[]} workflows={[]} query={query}
    onPick={vi.fn()} onPickWorkflow={onPickWorkflow} onPickCatalog={onPickCatalog} onPickGoal={onPickGoal} />))
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
