import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { InlineImage, type InlineImageProps } from "./InlineImage"
import { englishMarkdownText } from "./text"

const mounted: (() => void)[] = []
function mountImage(props: Omit<InlineImageProps, "text">) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <InlineImage {...props} text={englishMarkdownText} />, host)
  mounted.push(() => { dispose(); host.remove() })
  flush()
  return host
}

afterEach(() => {
  for (const dispose of mounted.splice(0)) dispose()
})

const dataUrl = "data:image/png;base64,aGVsbG8="

it("uses the injected local image reader and opens the preview for its returned image", async () => {
  const readImage = vi.fn().mockResolvedValue(dataUrl)
  const preview = vi.fn()
  const host = mountImage({ src: "/Users/example/picture.png", alt: "diagram", readImage, onPreviewImage: preview })
  await vi.waitFor(() => {
    flush()
    expect(host.querySelector("img")?.getAttribute("src")).toBe(dataUrl)
  })
  expect(readImage).toHaveBeenCalledExactlyOnceWith("/Users/example/picture.png")
  host.querySelector("button")!.click()
  expect(preview).toHaveBeenCalledExactlyOnceWith(dataUrl)
})

it("reports native failures without navigating to a local file URL", async () => {
  const readImage = vi.fn().mockRejectedValue(new Error("Image exceeds preview limit"))
  const host = mountImage({ src: "/Users/example/large.png", alt: "large", readImage })
  await vi.waitFor(() => {
    flush()
    expect(host.querySelector('[role="status"]')?.textContent)
      .toContain(englishMarkdownText("local_images_cannot_be_previewed_here_9378ebfb"))
  })
  expect(host.querySelector("img")).toBeNull()
})

it("decodes the Windows drive path from the image-only URL for the native reader", async () => {
  const readImage = vi.fn().mockResolvedValue(dataUrl)
  const host = mountImage({
    src: "/__bodhi_local_image__/C%3A%2FUsers%2Fexample%2Fpicture.png", alt: "Windows", readImage,
  })
  await vi.waitFor(() => {
    flush()
    expect(host.querySelector("img")?.getAttribute("src")).toBe(dataUrl)
  })
  expect(readImage).toHaveBeenCalledExactlyOnceWith("C:/Users/example/picture.png")
})
