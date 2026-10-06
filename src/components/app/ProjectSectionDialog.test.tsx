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
const submit = () => act(() => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })

describe("ProjectSectionDialog", () => {
  it("creates a trimmed device section without mutating the backend Project", async () => {
    const updateProject = vi.fn()
    useAppStore.setState({ projects: { [project.id]: project }, updateProject })
    const onClose = vi.fn()
    const onCreate = vi.fn()
    await act(async () => root.render(
      <ProjectSectionDialog projectId={project.id} existingSections={[]} onCreate={onCreate} onRemove={vi.fn()} onClose={onClose} />,
    ))
    expect(document.body.textContent).toContain("分区仅整理此设备的侧栏，不会改变项目目录或会话的运行环境。")
    setName("  Development  ")
    submit()
    expect(onCreate).toHaveBeenCalledWith("Development")
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
    submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("同名分区")
    setName("莲".repeat(81))
    submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("1–80")
    expect(onCreate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("removes a section through its device callback and explains where sessions go", async () => {
    useAppStore.setState({ projects: { [project.id]: project } })
    const onRemove = vi.fn()
    await act(async () => root.render(
      <ProjectSectionDialog projectId={project.id} mode="manage" existingSections={[{ id: "legacy", name: "Lotus" }]} onCreate={vi.fn()} onRemove={onRemove} onClose={vi.fn()} />,
    ))
    expect(document.body.textContent).toContain("会话保留在原项目中，并移到无分区。")
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="移除分区 Lotus"]')!.click())
    expect(onRemove).toHaveBeenCalledWith("legacy")
  })
})
