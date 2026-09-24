import { useEffect, useState, type ComponentProps } from "react"
import { isTauriEnvironment } from "@/utils/environment"
import { readLocalImage } from "@shared/services/FileOperationsService"
import { localImagePath } from "./streamdownConfig"

type ImageProps = ComponentProps<"img"> & { onPreviewImage?: (src: string) => void }

/** Markdown images stay inside the chat surface; local paths use Bodhi's bounded reader. */
export function InlineImage({ src, alt = "", onPreviewImage }: ImageProps) {
  const localPath = src ? localImagePath(src) : null
  const [loaded, setLoaded] = useState<{ path: string; dataUrl: string } | null>(null)
  const [failedPath, setFailedPath] = useState<string | null>(null)

  useEffect(() => {
    if (!localPath || !isTauriEnvironment()) return
    let cancelled = false
    readLocalImage(localPath)
      .then((dataUrl) => {
        if (!cancelled) setLoaded({ path: localPath, dataUrl })
      })
      .catch(() => {
        if (!cancelled) setFailedPath(localPath)
      })
    return () => { cancelled = true }
  }, [localPath])

  if (!src) return null
  if (localPath && (!isTauriEnvironment() || failedPath === localPath)) {
    return <span role="status" className="text-xs text-muted-foreground">本地图片无法在此处预览：{alt || localPath}</span>
  }
  if (localPath && loaded?.path !== localPath) {
    return <span role="status" className="text-xs text-muted-foreground">正在加载图片…</span>
  }

  const imageSrc = localPath ? loaded!.dataUrl : src
  const image = <img src={imageSrc} alt={alt} data-streamdown="image" className="max-h-48 max-w-full rounded-xl object-contain" />
  return onPreviewImage ? (
    <button type="button" onClick={() => onPreviewImage(imageSrc)} aria-label={`预览图片${alt ? `：${alt}` : ""}`} className="cursor-zoom-in">
      {image}
    </button>
  ) : image
}
