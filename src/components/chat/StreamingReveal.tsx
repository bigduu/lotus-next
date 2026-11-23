import {
  memo, useId, useLayoutEffect, useMemo, useRef, type ComponentProps,
} from "react"
import { Block, type BlockProps } from "streamdown"

import { createRevealPlugin } from "./streamdownReveal"

const MAX_ENTERING_BLOCKS = 12
const PROSE_BLOCK = "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote"

function renderedBlock(block: Element) {
  const first = block.firstElementChild
  return first?.hasAttribute("dir") ? first.firstElementChild : first
}

function revealEnteringBlock(block: HTMLElement) {
  const prose = renderedBlock(block)
  if (!prose?.matches(PROSE_BLOCK)) return
  // Every block renders immediately. Limit animation to the live end of a
  // large batch. Streamdown also emits empty blocks for paragraph breaks.
  if (block.parentElement?.childElementCount === 1) return
  let count = 1
  for (let next = block.nextElementSibling; next; next = next.nextElementSibling) {
    if (renderedBlock(next) && ++count > MAX_ENTERING_BLOCKS) return
  }
  const document = block.ownerDocument
  if (document.hidden || document.body.dataset.vdiSafe === "true" || block.closest("[inert]") ||
      document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

  const firstChunk = prose.querySelector("[data-assistant-reveal-chunk]")
  if (!firstChunk) return
  // Mixed blocks can still reveal their leading prose while interactive
  // content, code and images stay at full opacity.
  const target = prose.querySelector("a, button, code, img, pre, table") ? firstChunk : prose
  // Animate in this layout commit so all newly visible blocks start together.
  // The animation belongs to this mount and can finish while hidden.
  return target.animate?.([{ opacity: 0.55 }, { opacity: 1 }], { duration: 140, easing: "ease-out" })
}

/** Commit prefix bookkeeping only after React commits, including StrictMode. */
export const StreamingRevealBlock = memo(function StreamingRevealBlock({ rehypePlugins, ...props }: BlockProps) {
  const id = useId()
  const hostRef = useRef<HTMLDivElement>(null)
  const reveal = useMemo(() => createRevealPlugin(id), [id])
  const plugins = useMemo(() => [...(rehypePlugins ?? []), reveal.plugin], [rehypePlugins, reveal])
  useLayoutEffect(() => { reveal.commit() })
  useLayoutEffect(() => {
    const animation = revealEnteringBlock(hostRef.current!)
    return () => animation?.cancel()
  }, [])
  return (
    <div ref={hostRef} data-assistant-reveal-block="true" style={{ display: "contents" }}>
      <Block {...props} rehypePlugins={plugins} />
    </div>
  )
})

function RevealChunk({ value, reveal, tail }: { value: string; reveal: boolean; tail: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<Text | null>(null)
  const revealOnMount = useRef(reveal).current
  useLayoutEffect(() => {
    const host = hostRef.current!
    if (!textRef.current) {
      textRef.current = host.ownerDocument.createTextNode(value)
      host.insertBefore(textRef.current, host.firstChild)
    } else if (value === textRef.current.data) return
    else if (value.startsWith(textRef.current.data)) {
      // appendData preserves existing Range offsets, unlike replacing nodeValue.
      textRef.current.appendData(value.slice(textRef.current.length))
    } else textRef.current.data = value
  }, [value])
  return (
    <span ref={hostRef} data-assistant-reveal-chunk="true"
      data-assistant-reveal={revealOnMount ? "true" : undefined}>
      {tail ? <span aria-hidden="true" data-assistant-streaming-caret="true" /> : null}
    </span>
  )
}

export function StreamingRevealSpan({ children, node: _node, ...props }:
  ComponentProps<"span"> & { node?: unknown; "data-assistant-reveal-chunk"?: string;
    "data-assistant-reveal"?: string; "data-assistant-reveal-tail"?: string }) {
  if (props["data-assistant-reveal-chunk"] !== "true") return <span {...props}>{children}</span>
  return <RevealChunk value={String(children ?? "")} reveal={props["data-assistant-reveal"] === "true"}
    tail={props["data-assistant-reveal-tail"] === "true"} />
}
