const MAX_RASTER_EDGE = 4096
const RASTER_SCALE = 3

type DiagramImage = { svgUrl: string; pngUrl?: string; width: number }

export async function rasterizeMermaid(svgMarkup: string, signal: AbortSignal): Promise<DiagramImage> {
  const parsed = new DOMParser().parseFromString(svgMarkup, "image/svg+xml")
  const svg = parsed.documentElement
  if (svg.localName !== "svg") throw new Error("Invalid diagram image")
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number)
  const width = viewBox?.[2] || parseFloat(svg.getAttribute("width") ?? "")
  const height = viewBox?.[3] || parseFloat(svg.getAttribute("height") ?? "")
  const sized = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  if (sized) {
    svg.setAttribute("width", String(width))
    svg.setAttribute("height", String(height))
    svg.style.maxWidth = "none"
  }
  const markup = new XMLSerializer().serializeToString(svg)
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  const fallback = { svgUrl, width: sized ? width : 0 }
  if (!sized) return fallback

  // Loading as an image keeps SVG styles and contents out of the parent DOM.
  const image = new Image()
  image.src = svgUrl
  try {
    await image.decode()
    signal.throwIfAborted()
    const scale = Math.min(RASTER_SCALE, MAX_RASTER_EDGE / Math.max(width, height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext("2d")
    if (!context) return fallback
    context.fillStyle = "#fff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { ...fallback, pngUrl: canvas.toDataURL("image/png") }
  } catch (error) {
    if (signal.aborted) throw error
    return fallback
  }
}
