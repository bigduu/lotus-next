import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  groupSessionFileChanges,
  type SessionFileChange,
} from "@/lib/sessionFileChanges"
import { FileChangeList } from "./FileChangeList"

const mountedRoots: Root[] = []
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

function groupsFor(paths: string[]) {
  const changes: SessionFileChange[] = paths.map((file_path, index) => ({
    id: `change-${index}`,
    payload: {
      operation: "edit",
      file_path,
      diff: {
        unified: index === 0 ? "+a\n+b\n-c" : "+d",
      },
    },
  }))
  return groupSessionFileChanges(changes)
}

function render(ui: React.ReactElement) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  act(() => root.render(ui))
  return host
}

describe("FileChangeList", () => {
  it("renders unique file groups with aggregated stats", () => {
    const host = render(
      <FileChangeList groups={groupsFor(["src/a.ts", "src/b.ts", "src/a.ts"])} />,
    )

    expect(host.querySelectorAll("details")).toHaveLength(2)
    expect(host.textContent).toContain("src/a.ts")
    expect(host.textContent).toContain("src/b.ts")
    expect(host.textContent).toContain("2 次修改")
    expect(host.textContent).toContain("+3")
    expect(host.textContent).toContain("−1")
  })

  it("renders basename paths and compact density", () => {
    const host = render(
      <FileChangeList
        groups={groupsFor(["src/a.ts", "src/b.ts"])}
        pathMode="basename"
        density="compact"
      />,
    )

    expect(host.textContent).toContain("a.ts")
    expect(host.textContent).toContain("b.ts")
    expect(host.textContent).not.toContain("src/a.ts")
    expect(host.querySelector<HTMLDivElement>("[class*='space-y-1.5']")).not.toBeNull()
  })

  it("opens only the most recently edited file when requested", () => {
    const host = render(
      <FileChangeList
        groups={groupsFor(["src/a.ts", "src/b.ts", "src/a.ts"])}
        defaultOpen={(index, total) => index === total - 1}
      />,
    )

    const details = host.querySelectorAll("details")
    expect(details[0]?.textContent).toContain("src/b.ts")
    expect(details[0]?.open).toBe(false)
    expect(details[1]?.textContent).toContain("src/a.ts")
    expect(details[1]?.open).toBe(true)
  })

  it("honors a constant defaultOpen", () => {
    const host = render(
      <FileChangeList groups={groupsFor(["src/a.ts", "src/b.ts"])} defaultOpen />,
    )

    for (const details of host.querySelectorAll("details")) expect(details.open).toBe(true)
  })

  it("uses compact summary rows to hand off to Review", () => {
    const onSelect = vi.fn()
    const groups = groupsFor(["src/a.ts", "src/a.ts"])
    const host = render(
      <FileChangeList
        groups={groups}
        variant="summary"
        pathMode="basename"
        onSelect={onSelect}
      />,
    )

    expect(host.querySelectorAll("details")).toHaveLength(0)
    expect(host.textContent).toContain("2 次")
    act(() => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith(groups[0])
  })

  it("renders nothing for an empty group list", () => {
    const host = render(<FileChangeList groups={[]} />)
    expect(host.querySelectorAll("details")).toHaveLength(0)
  })
})
