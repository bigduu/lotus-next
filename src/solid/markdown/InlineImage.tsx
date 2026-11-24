import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { localImagePath } from "@/lib/assistantMarkdownSafety"
import type { MarkdownText } from "./text"

export interface InlineImageProps {
  src: string
  alt: string
  readImage?: (path: string) => Promise<string>
  onPreviewImage?: (src: string) => void
  text: MarkdownText
}

export function InlineImage(props: InlineImageProps) {
  const path = createMemo(() => localImagePath(props.src))
  const [loaded, setLoaded] = createSignal<{ path: string; src: string | null } | null>(null)

  createEffect(
    () => ({ path: path(), readImage: props.readImage }),
    ({ path, readImage }) => {
      if (!path || !readImage) return
      let active = true
      void readImage(path).then(
        (src) => { if (active) setLoaded({ path, src }) },
        () => { if (active) setLoaded({ path, src: null }) },
      )
      return () => { active = false }
    },
  )

  const current = createMemo(() => {
    const result = loaded()
    return result?.path === path() ? result : null
  })
  const src = () => path() ? (props.readImage ? current()?.src ?? undefined : undefined) : props.src
  const renderImage = () => (
    <img
      src={src()}
      alt={props.alt}
      data-streamdown="image"
      class="max-h-48 max-w-full rounded-xl object-contain"
    />
  )

  return (
    <Show when={src()} fallback={
      <Show when={path()}>
        <span role="status" class="text-xs text-muted-foreground">
          {props.readImage && !current()
            ? props.text("loading_image_e661c55e")
            : `${props.text("local_images_cannot_be_previewed_here_9378ebfb")} ${props.alt || path()}`}
        </span>
      </Show>
    }>
      <Show when={props.onPreviewImage} fallback={renderImage()}>
        <button type="button" onClick={() => { const preview = src(); if (preview) props.onPreviewImage?.(preview) }}
          aria-label={props.text("preview_image_1689cf75", { v0: props.alt ? `：${props.alt}` : "" })} class="cursor-zoom-in">
          {renderImage()}
        </button>
      </Show>
    </Show>
  )
}
