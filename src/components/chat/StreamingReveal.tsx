import {
  createContext, memo, useContext, useId, useLayoutEffect, useMemo, useRef,
  type ComponentProps, type ReactNode,
} from "react"
import { Block, type BlockProps } from "streamdown"

import { createRevealPlugin } from "./streamdownReveal"

const RevealMountContext = createContext({ current: false })

/** Existing text on a lazy/remounted stream is a baseline, never a replay. */
export function StreamingReveal({ isStreaming, children }: {
  isStreaming: boolean
  children: ReactNode
}) {
  const committedStream = useRef(false)
  useLayoutEffect(() => { committedStream.current = isStreaming }, [isStreaming])
  return <RevealMountContext.Provider value={committedStream}>{children}</RevealMountContext.Provider>
}

/** Commit prefix bookkeeping only after React commits, including StrictMode. */
export const StreamingRevealBlock = memo(function StreamingRevealBlock({ rehypePlugins, ...props }: BlockProps) {
  const mounted = useContext(RevealMountContext)
  const id = useId()
  const reveal = useMemo(() => createRevealPlugin(id, mounted.current), [id, mounted])
  const plugins = useMemo(() => [...(rehypePlugins ?? []), reveal.plugin], [rehypePlugins, reveal])
  useLayoutEffect(() => { reveal.commit() })
  return (
    <div data-assistant-reveal-block="true" style={{ display: "contents" }}>
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
