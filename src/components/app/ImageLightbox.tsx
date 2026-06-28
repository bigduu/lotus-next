import { X } from "lucide-react"

/** Fullscreen image preview (tap backdrop or ✕ to dismiss). */
export function ImageLightbox({
  src,
  onClose,
}: {
  src: string | null
  onClose: () => void
}) {
  if (!src) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 sm:p-8"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white backdrop-blur transition-colors hover:bg-white/25"
        aria-label="关闭预览"
      >
        <X className="size-5" />
      </button>
    </div>
  )
}
