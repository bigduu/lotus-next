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

describe("ProjectSectionDialog", () => {
  it("persists a trimmed Section through the Project CAS update", async () => {
    const updateProject = vi.fn(async (_id, _revision, patch) => ({
      ...project,
      ...patch,
      revision: 5,
    }))
    useAppStore.setState({ projects: { [project.id]: project }, updateProject })
    const onClose = vi.fn()

    await act(async () => root.render(
      <ProjectSectionDialog projectId={project.id} existingSections={[]} onClose={onClose} />,
    ))
    const input = document.querySelector<HTMLInputElement>("#project-section-name")!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => {
      setter.call(input, "  Development  ")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const create = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("创建并移动"))!
    await act(async () => create.click())

    expect(updateProject).toHaveBeenCalledWith("project-a", 4, { section: "Development" })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
