export const normalizeBrowserAddress = (draft: string): string | null => {
  const text = draft.trim()
  if (!text) return null
  try {
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(text)?.[1]?.toLowerCase()
    const hostWithPort = /^[a-z\d.-]+:\d+(?:\/|$)/i.test(text)
    if (scheme && scheme !== "http" && scheme !== "https" && !hostWithPort) return null
    const candidate = scheme === "http" || scheme === "https"
      ? text
      : hostWithPort && /^(?:localhost|127(?:\.\d+){3}|\[::1\]):/i.test(text)
        ? `http://${text}`
        : `https://${text}`
    const url = new URL(candidate)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

export const playwrightKey = (event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string => {
  const modifiers = [
    event.ctrlKey && event.key !== "Control" ? "Control" : null,
    event.metaKey && event.key !== "Meta" ? "Meta" : null,
    event.altKey && event.key !== "Alt" ? "Alt" : null,
    event.shiftKey && event.key !== "Shift" ? "Shift" : null,
  ].filter(Boolean)
  return [...modifiers, event.key].join("+")
}
