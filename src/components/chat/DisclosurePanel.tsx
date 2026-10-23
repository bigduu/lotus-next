import { useLayoutEffect, useRef, type ComponentProps, type RefObject } from "react"
import { cn } from "@/lib/utils"

type DisclosurePanelProps = Omit<ComponentProps<"div">, "hidden" | "inert" | "aria-hidden"> & {
  expanded: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
}

/** Keep inspection state mounted while CSS follows the disclosure's intrinsic height. */
export function DisclosurePanel({ expanded, triggerRef, className, children, ...props }: DisclosurePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const wasExpanded = useRef(expanded)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    // Return internal focus before making the subtree inert, including a
    // controlled close. Focus elsewhere must remain with its current owner.
    if (wasExpanded.current && !expanded && panel.contains(panel.ownerDocument.activeElement)) {
      triggerRef.current?.focus({ preventScroll: true })
    }
    panel.toggleAttribute("inert", !expanded)
    panel.setAttribute("aria-hidden", String(!expanded))
    wasExpanded.current = expanded
  }, [expanded, triggerRef])

  return (
    <div
      {...props}
      ref={panelRef}
      data-disclosure-panel
      data-state={expanded ? "open" : "closed"}
      className={cn("disclosure-panel", className)}
    >
      <div className="disclosure-panel-clip">{children}</div>
    </div>
  )
}
