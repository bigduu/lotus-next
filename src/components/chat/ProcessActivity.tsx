import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ChevronRight } from "lucide-react"
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import "./ProcessActivity.css"

export interface ProcessActivityProps {
  children: ReactNode
  reasoning?: string
  toolCallCount?: number
  active?: boolean
  thinking?: boolean
  status?: string | null
  label?: string
  hasDetails?: boolean
  preview?: { key: string; content: ReactNode; running: boolean; snapshot?: (key: string) => ReactNode }
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onToggle?: (open: boolean) => void
}

type ActivityPreview = NonNullable<ProcessActivityProps["preview"]>

function motionAllowed(node: HTMLElement) {
  return typeof node.animate === "function"
    && document.body.dataset.vdiSafe !== "true"
    && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

/** The foreground step settles into the disclosure as execution moves on. */
function CurrentStep({ preview, expanded }: { preview?: ActivityPreview; expanded: boolean }) {
  const current = !expanded && preview?.running ? preview : undefined
  const previous = useRef<ActivityPreview | undefined>(undefined)
  const [leaving, setLeaving] = useState<ActivityPreview>()
  const leavingKey = leaving?.key
  const currentNode = useRef<HTMLDivElement>(null)
  const leavingNode = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const last = previous.current
    previous.current = current
    if (expanded) {
      setLeaving(undefined)
    } else if (last && last.key !== current?.key) {
      setLeaving({ ...last, content: preview?.snapshot?.(last.key) ?? (preview?.key === last.key ? preview.content : last.content) })
    }
  }, [current, expanded, preview])

  useLayoutEffect(() => {
    const node = currentNode.current
    if (!node || !motionAllowed(node)) return
    const animation = node.animate([
      { opacity: 0, transform: "translateY(4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 180, easing: "ease-out" })
    return () => animation.cancel()
  }, [current?.key])

  useLayoutEffect(() => {
    const node = leavingNode.current
    if (!node || !leavingKey) return
    const finish = () => setLeaving((value) => value?.key === leavingKey ? undefined : value)
    if (!motionAllowed(node)) {
      finish()
      return
    }
    const height = `${node.getBoundingClientRect().height}px`
    const animation = node.animate([
      { height, opacity: 1, transform: "translateY(0) scale(1)", offset: 0 },
      { height, opacity: 1, transform: "translateY(0) scale(1)", offset: 0.35 },
      { height: "0px", opacity: 0, transform: "translateY(-12px) scale(0.98)" },
    ], { duration: 420, easing: "ease-in-out", fill: "forwards" })
    animation.finished.then(finish, () => {})
    return () => animation.cancel()
  }, [leavingKey])

  return <div className="-mx-3.5">
    {leaving ? <div ref={leavingNode} data-process-handoff aria-hidden="true" style={{ overflow: "hidden", transformOrigin: "top left" }}>{leaving.content}</div> : null}
    {current ? <div key={current.key} ref={currentNode} data-process-current>{current.content}</div> : null}
  </div>
}

/** A short excerpt of the newest sentence, never a generated interpretation. */
// oxlint-disable-next-line react/only-export-components -- Shared pure formatter within this component's public contract.
export function extractProcessBrief(reasoning: string | undefined, limit = 72): string {
  if (!reasoning || limit < 1) return ""
  // Formatting a long thought on every streamed token must stay bounded.
  const plain = reasoning.slice(-2048)
    .replace(/^[\uDC00-\uDFFF]/u, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm, "")
    .replace(/^[ \t]*[-_*]{3,}[ \t]*$/gm, "")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-+*][ \t]+|\d+[.)][ \t]+)+/gm, "")
    .replace(/^[ \t]*\[[ xX]\][ \t]+/gm, "")
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, "$1")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/`+|\*\*|__|~~/g, "")
    .replace(/(^|[^\p{L}\p{N}])[*_]|[*_]($|[^\p{L}\p{N}])/gu, "$1$2")
  const sentences = plain
    .split(/(?<=[。！？!?])[ \t]*|(?<=\.)[ \t]+|\n+/u)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const latest = sentences.at(-1) ?? ""
  const characters = Array.from(latest)
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : latest
}

/** One stable disclosure for a continuous reasoning and tool-call process. */
export function ProcessActivity({
  children,
  reasoning,
  toolCallCount = 0,
  active = false,
  thinking = false,
  status,
  label,
  hasDetails = true,
  preview,
  open,
  onOpenChange,
  onToggle,
}: ProcessActivityProps) {
  useUiLocale()
  const [localOpen, setLocalOpen] = useState(false)
  const contentId = useId()
  const expanded = open ?? localOpen
  const resolvedLabel = label ?? uiText(active && thinking ? "thinking_64088d8c" : "process_activity")
  const reasoningBrief = extractProcessBrief(reasoning)
  const toolCountLabel = toolCallCount > 0 ? uiText("process_tool_count", { count: toolCallCount }) : ""
  const toolBrief = extractProcessBrief(status ?? undefined) || toolCountLabel
  const brief = active && thinking && !reasoningBrief && !status?.trim()
    ? resolvedLabel
    : active && !thinking
    ? toolBrief || reasoningBrief || resolvedLabel
    : reasoningBrief || toolBrief || resolvedLabel

  const toggle = () => {
    const nextOpen = !expanded
    if (open === undefined) setLocalOpen(nextOpen)
    onOpenChange?.(nextOpen)
    onToggle?.(nextOpen)
  }

  const summary = <>
    {hasDetails ? <ChevronRight className="process-activity-icon" aria-hidden="true" /> : null}
    {hasDetails && brief !== resolvedLabel ? <span className="process-activity-label">{resolvedLabel}</span> : null}
    <span
      data-process-brief
      data-process-shimmer={active && thinking || undefined}
      className={`process-activity-brief${active && thinking ? " process-activity-shimmer" : ""}`}
    >
      {brief}
    </span>
    {toolCountLabel && brief !== toolCountLabel ? <span className="process-activity-count">{toolCountLabel}</span> : null}
  </>

  return (
    <div data-process-activity className="process-activity">
      {hasDetails ? <button
        type="button"
        data-process-toggle
        aria-label={resolvedLabel}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="process-activity-toggle"
        onClick={toggle}
      >
        {summary}
      </button> : <div data-process-status role="status" className="process-activity-toggle" style={{ cursor: "default" }}>{summary}</div>}
      <CurrentStep preview={preview ? { ...preview, running: active && preview.running } : undefined} expanded={expanded} />
      {hasDetails ? <div
        id={contentId}
        data-process-content
        role="region"
        aria-label={resolvedLabel}
        hidden={!expanded}
        className="process-activity-content"
      >
        {children}
      </div> : null}
    </div>
  )
}
