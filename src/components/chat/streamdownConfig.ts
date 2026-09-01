import type { CodeHighlighterPlugin, ThemeInput, UrlTransform } from "streamdown"

export const STREAMDOWN_THEMES: [ThemeInput, ThemeInput] = ["github-light", "github-dark"]

let codePluginPromise: Promise<CodeHighlighterPlugin> | undefined

function loadCodePlugin(): Promise<CodeHighlighterPlugin> {
  codePluginPromise ??= import("@streamdown/code").then((module) => module.code)
  return codePluginPromise
}

/** Load Shiki only after Streamdown asks to highlight an actual fenced block. */
export const lazyCodePlugin: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getSupportedLanguages: () => [],
  getThemes: () => STREAMDOWN_THEMES,
  supportsLanguage: () => true,
  highlight(options, callback) {
    void loadCodePlugin().then((plugin) => {
      const immediate = plugin.highlight(options, callback)
      if (immediate) callback?.(immediate)
    })
    return null
  },
}

const SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"])

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
}

/** Match the old sanitized renderer's URL surface, while rejecting data/blob/script URLs. */
export const safeAssistantUrlTransform: UrlTransform = (url, key) => {
  const value = url.trim()
  if (!value || value !== url || hasControlCharacter(value)) return null
  if (key !== "href" && key !== "src") return null

  if (!SCHEME.test(value)) {
    // Backslashes are URL separators in browsers and can turn a seemingly
    // relative target into a scheme-relative cross-origin request.
    return value.includes("\\") || value.startsWith("//") ? null : value
  }

  try {
    const protocol = new URL(value).protocol.toLowerCase()
    const allowed = key === "src" ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS
    return allowed.has(protocol) ? value : null
  } catch {
    return null
  }
}
