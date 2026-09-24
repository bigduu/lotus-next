import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"

const { invoke, desktop } = vi.hoisted(() => ({
  invoke: vi.fn(),
  desktop: { value: true },
}))
vi.mock("@shared/services/FileOperationsService", () => ({ readLocalImage: (path: string) => invoke("read_local_image", { path }) }))
vi.mock("@/utils/environment", () => ({ isTauriEnvironment: () => desktop.value }))

import { InlineImage } from "./InlineImage"

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => { Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT") })
afterEach(() => { document.body.replaceChildren(); invoke.mockReset(); desktop.value = true })

it("loads a local Markdown image through Bodhi and opens the existing preview", async () => {
  const dataUrl = "data:image/png;base64,aGVsbG8="
  invoke.mockResolvedValue(dataUrl)
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const preview = vi.fn()
  await act(async () => root.render(
    <InlineImage src="/Users/example/picture.png" alt="diagram" onPreviewImage={preview} />,
  ))
  await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe(dataUrl))
  expect(invoke).toHaveBeenCalledExactlyOnceWith("read_local_image", { path: "/Users/example/picture.png" })
  act(() => host.querySelector("button")?.click())
  expect(preview).toHaveBeenCalledWith(dataUrl)
  act(() => root.unmount())
})

it("reports native failures without navigating to a local file URL", async () => {
  invoke.mockRejectedValue(new Error("Image exceeds preview limit"))
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<InlineImage src="/Users/example/large.png" alt="large" />))
  await vi.waitFor(() => expect(host.querySelector("[role=status]")?.textContent).toContain("无法在此处预览"))
  expect(host.querySelector("img")).toBeNull()
  act(() => root.unmount())
})

it("passes a Windows drive path decoded from an image-only URL to Bodhi", async () => {
  invoke.mockResolvedValue("data:image/png;base64,aGVsbG8=")
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<InlineImage src="/__bodhi_local_image__/C%3A%2FUsers%2Fexample%2Fpicture.png" alt="Windows" />))
  await vi.waitFor(() => expect(host.querySelector("img")).not.toBeNull())
  expect(invoke).toHaveBeenCalledExactlyOnceWith("read_local_image", { path: "C:/Users/example/picture.png" })
  act(() => root.unmount())
})
