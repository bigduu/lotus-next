import { createSignal, flush, Show } from "solid-js"
import { render, type ComponentProps, type JSX } from "@solidjs/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import type { SidebarUpdateError } from "@/lib/projectSidebarWrites"
import { ProjectSectionDialog } from "./ProjectSectionDialog"

vi.mock("@lucide/solid", () => ({ Trash2: () => <svg aria-hidden="true" /> }))

// The section browser tests cover the responsive portal and focus. These tests
// exercise the real form and controls inside the dialog.
vi.mock("../ui/responsive-dialog", () => ({
  ResponsiveDialog: (props: { open?: boolean; children: JSX.Element }) =>
    <Show when={props.open}>{props.children}</Show>,
  ResponsiveDialogContent: (props: Pick<JSX.IntrinsicElements["div"], "aria-busy" | "children">) =>
    <div role="dialog" aria-busy={props["aria-busy"]}>{props.children}</div>,
  ResponsiveDialogTitle: (props: { children: JSX.Element }) => <h2>{props.children}</h2>,
  ResponsiveDialogDescription: (props: { children: JSX.Element }) => <p>{props.children}</p>,
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

type DialogProps = ComponentProps<typeof ProjectSectionDialog>

function mount(props: Partial<DialogProps> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => <ProjectSectionDialog
    projectName="Zenith" mode="create" sections={[]} busy={false} unavailable={false}
    onCreate={async () => true} onRemove={async () => true} onClose={() => {}}
    {...props} />, host)
  flush()
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  const name = () => host.querySelector<HTMLInputElement>('[role="dialog"] form input')!
  return {
    host,
    name,
    alert: () => host.querySelector('[role="alert"]')?.textContent,
    remove: () => host.querySelector<HTMLButtonElement>('button[aria-label="移除分区 Lotus"]')!,
    setName(value: string) {
      const input = name()
      input.value = value
      input.dispatchEvent(new Event("input", { bubbles: true }))
      flush()
    },
    async submit() {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      await settle()
    },
  }
}

async function settle() {
  await Promise.resolve()
  flush()
}

const lotus = [{ id: "legacy", name: "Lotus" }]

describe("ProjectSectionDialog", () => {
  it("closes only after the trimmed section is confirmed by the server callback", async () => {
    const originalUpdateProject = appStore.getState().updateProject
    const updateProject = vi.fn()
    appStore.setState({ updateProject })
    cleanups.push(() => appStore.setState({ updateProject: originalUpdateProject }))
    const onClose = vi.fn()
    let confirm!: (saved: boolean) => void
    const onCreate = vi.fn(() => new Promise<boolean>((resolve) => { confirm = resolve }))
    const dialog = mount({ onCreate, onClose })
    expect(dialog.host.textContent).toContain("分区和会话归属会保存到服务端，可在连接同一服务的设备上恢复。")
    dialog.setName("  Development  ")
    await dialog.submit()
    expect(onCreate).toHaveBeenCalledWith("Development")
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog.name().value).toBe("  Development  ")
    confirm(true)
    await settle()
    expect(onClose).toHaveBeenCalledOnce()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("rejects a duplicate or overlong name and keeps the dialog open", async () => {
    const onCreate = vi.fn()
    const onClose = vi.fn()
    const dialog = mount({ sections: lotus, onCreate, onClose })
    dialog.setName(" lotus ")
    await dialog.submit()
    expect(dialog.alert()).toContain("同名分区")
    dialog.setName("莲".repeat(81))
    await dialog.submit()
    expect(dialog.alert()).toContain("1–80")
    expect(onCreate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("removes a section through its server callback and explains where sessions go", async () => {
    const onRemove = vi.fn().mockResolvedValue(true)
    const dialog = mount({ mode: "manage", sections: lotus, onRemove })
    expect(dialog.host.textContent).toContain("会话保留在原项目中，并移到无分区。")
    dialog.remove().click()
    expect(onRemove).toHaveBeenCalledWith("legacy")
  })

  it("retains the name and dialog after a failed save so the user can retry", async () => {
    const [error, setError] = createSignal<SidebarUpdateError>()
    const onCreate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const onClose = vi.fn()
    const dialog = mount({ get error() { return error() }, onCreate, onClose })
    dialog.setName("Research")
    await dialog.submit()
    setError("save-failed")
    flush()
    expect(dialog.name().value).toBe("Research")
    expect(dialog.alert()).toContain("分区未保存")
    expect(onClose).not.toHaveBeenCalled()
    await dialog.submit()
    expect(onCreate).toHaveBeenNthCalledWith(2, "Research")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("prevents edits, removal and close while a server save is pending", async () => {
    const [busy, setBusy] = createSignal(false)
    const onCreate = vi.fn().mockResolvedValue(true)
    const onRemove = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    const dialog = mount({ mode: "manage", sections: lotus, get busy() { return busy() }, onCreate, onRemove, onClose })
    dialog.setName("Research")
    setBusy(true)
    flush()
    expect(dialog.host.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true")
    expect(dialog.name().disabled).toBe(true)
    for (const button of dialog.host.querySelectorAll<HTMLButtonElement>('button[type="submit"], button[aria-label="移除分区 Lotus"]')) {
      expect(button.disabled).toBe(true)
      button.click()
    }
    const cancel = [...dialog.host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "取消")!
    expect(cancel.disabled).toBe(true)
    cancel.click()
    await dialog.submit()
    expect(onCreate).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("keeps local data readable but disables mutations for an unsupported backend", async () => {
    const onCreate = vi.fn().mockResolvedValue(true)
    const onRemove = vi.fn().mockResolvedValue(true)
    const dialog = mount({ mode: "manage", sections: lotus, unavailable: true, onCreate, onRemove })
    expect(dialog.alert()).toContain("请更新 Bamboo 后端以保存分区")
    expect(dialog.name().disabled).toBe(true)
    expect(dialog.remove().disabled).toBe(true)
    await dialog.submit()
    expect(onCreate).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
  })
})
