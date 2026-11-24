import { createSignal, type Accessor } from "solid-js"

export type WidthBounds = { min: number; max: number }

export const clampPanelWidth = (width: number, { min, max }: WidthBounds) => Math.min(max, Math.max(min, width))

/** Temporary layout limits never overwrite a completed preferred width. */
export function createStoredPanelWidth(key: string, fallback: number, bounds: Accessor<WidthBounds>) {
  let initial = fallback
  try {
    const saved = Number(localStorage.getItem(key))
    if (Number.isFinite(saved) && saved > 0) initial = saved
  } catch { /* Storage can be unavailable. */ }
  const [preferred, setPreferred] = createSignal(initial)
  const width = () => clampPanelWidth(preferred(), bounds())
  const setWidth = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return
    const next = clampPanelWidth(value, bounds())
    setPreferred(next)
    try {
      localStorage.setItem(key, String(next))
    } catch { /* Preserve the in-memory preference. */ }
  }
  return { width, setWidth }
}
