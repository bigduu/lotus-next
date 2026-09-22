import { useEffect, useRef, useState, type RefObject } from "react"

/** Observe the rendered container rather than inferring its width from the viewport. */
export function useContainerWidth<T extends HTMLElement>(
  enabled = true,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const element = ref.current
    if (!element) return

    const measureWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width)
      setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth))
    }

    measureWidth()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureWidth)
      return () => window.removeEventListener("resize", measureWidth)
    }

    let animationFrame: number | null = null
    const scheduleMeasurement = () => {
      if (animationFrame !== null) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null
        measureWidth()
      })
    }

    const observer = new ResizeObserver(scheduleMeasurement)
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
    }
  }, [enabled])

  return [ref, width]
}
