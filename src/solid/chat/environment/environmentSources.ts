import type { Message } from "@shared/types/chatMessages"

export type EnvironmentSource = {
  id: string
  name: string
  kind: "file" | "image"
  previewUrl?: string
}

export type EnvironmentDraftAttachment = { id: string; name: string; url: string }

export const environmentPathName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** Project durable and draft attachments into the compact Environment list. */
export function collectEnvironmentSources(
  earlier: readonly Message[],
  messages: readonly Message[],
  attachments: readonly EnvironmentDraftAttachment[],
): EnvironmentSource[] {
  const sources = new Map<string, EnvironmentSource>()
  const collect = (entries: readonly Message[]) => {
    for (const message of entries) {
      if ("images" in message) {
        for (const image of message.images ?? []) {
          const previewUrl = image.url ?? (image.base64
            ? image.base64.startsWith("data:")
              ? image.base64
              : `data:${image.type || "image/png"};base64,${image.base64}`
            : undefined)
          const id = `image:${image.id}`
          sources.set(id, { id, name: image.name, kind: "image", previewUrl })
        }
      }
      if ("type" in message && message.type === "file_reference") {
        for (const path of message.paths) {
          const id = `file:${path}`
          sources.set(id, { id, name: environmentPathName(path), kind: "file" })
        }
      }
    }
  }
  collect(earlier)
  collect(messages)
  for (const attachment of attachments) {
    const id = `draft:${attachment.id}`
    sources.set(id, { id, name: attachment.name, kind: "image", previewUrl: attachment.url })
  }
  return [...sources.values()]
}
