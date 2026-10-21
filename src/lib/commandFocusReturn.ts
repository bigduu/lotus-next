/** A newer control or navigation scope keeps ownership of focus. */
export function restoreCommandFocus(opener: HTMLElement | null) {
  const active = document.activeElement
  const parentFallback = opener?.closest("#right-workbench")
  if (active instanceof HTMLElement && active !== document.body && active !== parentFallback && !active.closest('[hidden], [inert], [aria-hidden="true"]')) return
  if (opener?.isConnected && opener !== document.body && !opener.matches(":disabled") && !opener.closest('[hidden], [inert], [aria-hidden="true"]')) opener.focus()
}
