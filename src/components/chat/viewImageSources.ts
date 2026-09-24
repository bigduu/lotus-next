import type { MessageImage } from "@shared/types/chatMessages"
import { apiClient } from "@services/api"

const RASTER_MIME = /^image\/(?:png|jpeg|gif|webp)$/i
const MAX_BASE64_LENGTH = Math.ceil((10 * 1024 * 1024) / 3) * 4
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Tool payloads may contain data URLs; never pass arbitrary schemes to an img. */
export function safeViewImageSource(image: MessageImage): string | null {
  const raw = image.url || (image.base64 && RASTER_MIME.test(image.type)
    ? `data:${image.type};base64,${image.base64}` : "")
  if (!raw) return null
  // Persisted Bamboo attachments are URLs resolved by the app's own API client.
  // Match the exact endpoint so a tool cannot turn this into a remote image fetch.
  try {
    const url = new URL(raw, window.location.href)
    const attachment = /\/sessions\/([^/]+)\/attachments\/([^/]+)$/.exec(url.pathname)
    if (attachment && url.href === apiClient.resolveUrl(`sessions/${attachment[1]}/attachments/${attachment[2]}`)) {
      return raw
    }
  } catch { /* data URLs are checked below */ }
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(raw)
  if (!match) return null
  const data = match[2]
  if (data.length > MAX_BASE64_LENGTH || data.length % 4 !== 0 || !BASE64.test(data)) return null
  return raw
}

export function isViewImageTool(toolName: string): boolean {
  const name = toolName.trim().toLowerCase().split(/__|::|\./).at(-1) ?? ""
  return /^(?:view_?image|open_?image|image_?view)$/.test(name)
}
