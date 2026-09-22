import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  groupSessionFileChanges,
  type SessionFileChange,
  type SessionFileChangeGroup,
} from "@/lib/sessionFileChanges"
import { FileChangeDisclosure } from "./FileChangeDisclosure"

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

function groupFor(
  path: string,
  diffs: string[] = ["+added line\n-removed line"],
): SessionFileChangeGroup {
  const changes: SessionFileChange[] = diffs.map((unified, index) => ({
    id: `change-${index}`,
    payload: {
      operation: "edit",
      file_path: path,
      diff: { unified },
    },
  }))
  return groupSessionFileChanges(changes)[0]!
}

function render(ui: React.ReactElement) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  act(() => root.render(ui))
  return host
}

describe("FileChangeDisclosure", () => {
  it("renders grouped stats and keeps the diff unmounted while collapsed", () => {
    const host = render(
      <FileChangeDisclosure group={groupFor("src/components/chat/Example.tsx")} />,
    )

    expect(host.textContent).toContain("src/components/chat/Example.tsx")
    expect(host.textContent).toContain("+1")
    expect(host.textContent).toContain("−1")
    expect(host.textContent).not.toContain("added line")
    expect(host.querySelector("details")?.open).toBe(false)
  })

  it("supports basename and workspace-relative paths", () => {
    const basenameHost = render(
      <FileChangeDisclosure
        pathMode="basename"
        group={groupFor("/workspace/src/components/chat/Example.tsx", [""])}
      />,
    )
    expect(basenameHost.textContent).toContain("Example.tsx")
    expect(basenameHost.textContent).not.toContain("src/components/chat")

    const relativeHost = render(
      <FileChangeDisclosure
        pathMode="relative"
        workspace="/workspace"
        group={groupFor("/workspace/src/components/chat/Example.tsx", [""])}
      />,
    )
    expect(relativeHost.textContent).toContain("src/components/chat/Example.tsx")
    expect(relativeHost.textContent).not.toContain("/workspace/src")
  })

  it("keeps the title attribute as the full path", () => {
    const host = render(
      <FileChangeDisclosure
        pathMode="basename"
        group={groupFor("src/components/chat/Example.tsx", [""])}
      />,
    )

    expect(host.querySelector<HTMLSpanElement>("span[title]")?.getAttribute("title")).toBe(
      "src/components/chat/Example.tsx",
    )
  })

  it("renders every chronological patch inside one file disclosure", () => {
    const host = render(
      <FileChangeDisclosure
        defaultOpen
        group={groupFor("a.ts", [
          "--- /workspace/a.ts\n+++ /workspace/a.ts\n@@ -1 +1 @@\n-old\n+new",
          "@@ -2 +2 @@\n-before\n+after",
        ])}
      />,
    )

    const text = host.textContent ?? ""
    expect(host.querySelectorAll("details")).toHaveLength(1)
    expect(text).toContain("2 次修改")
    expect(text).toContain("修改 1 / 2")
    expect(text).toContain("修改 2 / 2")
    expect(text).toContain("old")
    expect(text).toContain("after")
    expect(text).not.toContain("/workspace/a.ts")
  })

  it("renders compact density and disables split view in a narrow container", () => {
    const host = render(
      <FileChangeDisclosure
        defaultOpen
        density="compact"
        group={groupFor("a.ts", ["@@ -1 +1 @@\n-old\n+new"])}
      />,
    )

    expect(host.querySelector("summary")?.className).toContain("text-xs")
    expect(host.querySelector<HTMLButtonElement>("button[title*='展开面板']")?.disabled).toBe(true)
  })
})
