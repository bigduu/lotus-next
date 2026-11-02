/** Runtime-notice detection helpers shared by the message renderer and the
 * chat pane. Kept out of the component file so React fast refresh stays valid.
 */

/** Metadata shape attached by the Bamboo runtime to authored notices. */
export interface RuntimeNoticeInfo {
  runtimeKind: string
  execSessionId?: string
}

/** Exact frozen producer text prefix (pipeline notice), for channels that
 * strip message metadata. Keyed to the Bamboo runtime source, not a model. */
const BACKGROUND_EXEC_WAIT_NOTICE_PATTERN = /^Moved command `([^`]+)` to background monitoring\./

/**
 * Recognize runtime-authored assistant notices. The engine emits machine-text
 * notices (English) with identifying metadata; the renderer replaces them with
 * a localized status card instead of showing the raw text. Falls back to the
 * frozen producer prefix when metadata was stripped by the transport.
 */
export function runtimeNoticeFromMetadata(
  metadata: Record<string, unknown> | undefined,
  content?: string,
): RuntimeNoticeInfo | null {
  if (metadata && typeof metadata === "object" && metadata.runtime_kind === "background_exec_wait") {
    const handle = metadata.exec_session_id
    return {
      runtimeKind: "background_exec_wait",
      execSessionId: typeof handle === "string" && handle ? handle : undefined,
    }
  }
  const text = content ?? ""
  if (!text) return null
  const match = text.match(BACKGROUND_EXEC_WAIT_NOTICE_PATTERN)
  if (!match) return null
  return { runtimeKind: "background_exec_wait", execSessionId: match[1] }
}

/** Structural view of a transcript message used for wait detection. */
export type WaitDetectMessage = { metadata?: { runtime_kind?: unknown }; content?: string }

/** True while the background-exec wait this notice started is still relevant. */
export function backgroundExecWaitActive(messages: WaitDetectMessage[]): boolean {
  const last = messages[messages.length - 1]
  if (!last) return false
  if (last.metadata?.runtime_kind === "background_exec_wait") return true
  return typeof last.content === "string" && Boolean(last.content.match(BACKGROUND_EXEC_WAIT_NOTICE_PATTERN))
}
