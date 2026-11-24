import { createEffect, createMemo, createSignal, createUniqueId, type Accessor } from "solid-js"

type Preference = "auto" | "open" | "closed"

const MESSAGE_WORKSPACE_WIDTH = 1152
const ENVIRONMENT_OCCUPIED_WIDTH = 332
const AUTO_SHOW_MIN_WIDTH = MESSAGE_WORKSPACE_WIDTH + ENVIRONMENT_OCCUPIED_WIDTH

export function createEnvironment(options: {
  sessionId: Accessor<string | null>
  pageVisible: Accessor<boolean>
  sidePaneOpen: Accessor<boolean>
}) {
  const controlsId = createUniqueId()
  const [layout, bindLayout] = createSignal<HTMLDivElement>()
  const [width, setWidth] = createSignal(0)
  const visit = createMemo(() => ({ id: options.sessionId() }), {
    equals: (previous, next) => previous.id === next.id,
  })
  const [override, setOverride] = createSignal<{ visit: ReturnType<typeof visit>; preference: Preference }>()
  const preference = () => {
    const current = override()
    return current?.visit === visit() ? current.preference : "auto"
  }
  const floating = () => width() >= AUTO_SHOW_MIN_WIDTH
  const open = () => preference() === "open" || (preference() === "auto" && floating())
  const disabled = () => !visit().id || !options.pageVisible() || options.sidePaneOpen()
  const visible = () => !disabled() && open()
  const requestsHistory = () => visible() && preference() === "open"
  const reservedWidth = () => visible() && floating() ? ENVIRONMENT_OCCUPIED_WIDTH : 0

  createEffect(layout, (element) => {
    if (!element) return
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }

    let frame: number | undefined
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  })

  const toggle = () => {
    if (!disabled()) setOverride({ visit: visit(), preference: open() ? "closed" : "open" })
  }

  const dismiss = () => {
    if (visible()) setOverride({ visit: visit(), preference: "closed" })
  }

  const loadEarlier = () => {
    const currentVisit = visit()
    if (currentVisit.id && visible()) setOverride({ visit: currentVisit, preference: "open" })
  }

  return { controlsId, bindLayout, layoutWidth: width, preference, floating, visible, disabled, requestsHistory, reservedWidth, toggle, dismiss, loadEarlier }
}

export type EnvironmentController = ReturnType<typeof createEnvironment>
