import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectManifest } from "@services/project"
import { useAppStore } from "@shared/store/appStore"
import { ProjectSectionDialog } from "./ProjectSectionDialog"

const project: ProjectManifest = {
  id: "project-a",
  name: "Zenith",
  description: null,
  section: null,
  status: "active",
  revision: 4,
  resource_revision: 1,
  project_path: "/workspace/zenith",
  project_path_status: "configured",
  workspace_count: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  schema_version: 2,
  workspace_bindings: [],
}

let root: Root
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

const setName = (name: string) => {
  const input = document.querySelector<HTMLInputElement>("#project-section-name")!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  act(() => { setter.call(input, name); input.dispatchEvent(new Event("input", { bubbles: true })) })
}
const submit = () => act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })

describe("ProjectSectionDialog", () => {
  it("closes only after the trimmed section is confirmed by the server callback", async () => {
    const updateProject = vi.fn()
    useAppStore.setState({ projects: { [project.id]: project }, updateProject })
    const onClose = vi.fn()
    let confirm!: (saved: boolean) => void
    const onCreate = vi.fn(() => new Promise<boolean>((resolve) => { confirm = resolve }))
    await act(async () => root.render(
      <ProjectSectionDialog projectId={project.id} existingSections={[]} onCreate={onCreate} onRemove={vi.fn()} onClose={onClose} />,
    ))
    expect(document.body.textContent).toContain("分区和会话归属会保存到服务端，可在连接同一服务的设备上恢复。")
    setName("  Development  ")
    await submit()
    expect(onCreate).toHaveBeenCalledWith("Development")
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>("#project-section-name")!.value).toBe("  Development  ")
    await act(async () => confirm(true))
    expect(onClose).toHaveBeenCalledOnce()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("rejects a duplicate or overlong name and keeps the dialog open", async () => {
    useAppStore.setState({ projects: { [project.id]: project } })
    const onCreate = vi.fn()
    const onClose = vi.fn()
    await act(async () => root.render(
      <ProjectSectionDialog projectId={project.id} existingSections={[{ id: "lotus", name: "Lotus" }]} onCreate={onCreate} onRemove={vi.fn()} onClose={onClose} />,
    ))
    setName(" lotus ")
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("同名分区")
    setName("莲".repeat(81))
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("1–80")
    expect(onCreate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("removes a section through its server callback and explains where sessions go", async () => {
    useAppStore.setState({ projects: { [project.id]: project } })
    const onRemove = vi.fn().mockResolvedValue(true)
    await act(async () => root.render(
      <ProjectSectionDialog projectId={project.id} mode="manage" existingSections={[{ id: "legacy", name: "Lotus" }]} onCreate={vi.fn()} onRemove={onRemove} onClose={vi.fn()} />,
    ))
    expect(document.body.textContent).toContain("会话保留在原项目中，并移到无分区。")
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="移除分区 Lotus"]')!.click())
    expect(onRemove).toHaveBeenCalledWith("legacy")
  })

  it("retains the name and dialog after a failed save so the user can retry", async () => {
    useAppStore.setState({ projects: { [project.id]: project } })
    const onCreate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const onClose = vi.fn()
    const dialog = (saveError?: string) => <ProjectSectionDialog projectId={project.id} existingSections={[]} saveError={saveError} onCreate={onCreate} onRemove={vi.fn()} onClose={onClose} />
    await act(async () => root.render(dialog()))
    setName("Research")
    await submit()
    await act(async () => root.render(dialog("分区未保存，请检查连接后重试。")))
    expect(document.querySelector<HTMLInputElement>("#project-section-name")!.value).toBe("Research")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("分区未保存")
    expect(onClose).not.toHaveBeenCalled()
    await submit()
    expect(onCreate).toHaveBeenNthCalledWith(2, "Research")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("prevents edits, removal and close while a server save is pending", async () => {
    useAppStore.setState({ projects: { [project.id]: project } })
    const onCreate = vi.fn().mockResolvedValue(true)
    const onRemove = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    const dialog = (busy: boolean) => <ProjectSectionDialog projectId={project.id} mode="manage" existingSections={[{ id: "legacy", name: "Lotus" }]} busy={busy} onCreate={onCreate} onRemove={onRemove} onClose={onClose} />
    await act(async () => root.render(dialog(false)))
    setName("Research")
    await act(async () => root.render(dialog(true)))
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true")
    expect(document.querySelector<HTMLInputElement>("#project-section-name")!.disabled).toBe(true)
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[type="submit"], button[aria-label="移除分区 Lotus"]')) {
      expect(button.disabled).toBe(true)
      await act(async () => button.click())
    }
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "取消")!
    expect(cancel.disabled).toBe(true)
    await act(async () => cancel.click())
    await submit()
    expect(onCreate).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("keeps local data readable but disables mutations for an unsupported backend", async () => {
    useAppStore.setState({ projects: { [project.id]: project } })
    const onCreate = vi.fn().mockResolvedValue(true)
    const onRemove = vi.fn().mockResolvedValue(true)
    await act(async () => root.render(
      <ProjectSectionDialog projectId={project.id} mode="manage" existingSections={[{ id: "legacy", name: "Lotus" }]} unavailable onCreate={onCreate} onRemove={onRemove} onClose={vi.fn()} />,
    ))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("请更新 Bamboo 后端以保存分区")
    expect(document.querySelector<HTMLInputElement>("#project-section-name")!.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="移除分区 Lotus"]')!.disabled).toBe(true)
    await submit()
    expect(onCreate).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
  })
})
