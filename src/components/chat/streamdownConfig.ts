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
const RASTER_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i
const NATIVE_IMAGE_PREFIX = "/__bodhi_local_image__/"

function supportedNativePath(path: string): boolean {
  return RASTER_EXTENSION.test(path) &&
    ((path.startsWith("/") && !path.startsWith("//")) || /^[A-Za-z]:\//.test(path))
}

/** Rewrite only Markdown image nodes before rehype sanitizes URL protocols. */
export function nativeImageUrl(url: string): string | null {
  let path: string
  if (/^[A-Za-z]:[\\/]/.test(url)) {
    path = url.replace(/\\/g, "/")
  } else {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "file:" || parsed.host || parsed.search || parsed.hash) return null
      path = decodeURIComponent(parsed.pathname)
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    } catch { return null }
  }
  return supportedNativePath(path) ? `${NATIVE_IMAGE_PREFIX}${encodeURIComponent(path)}` : null
}

type MarkdownNode = { type: string; url?: string; children?: MarkdownNode[] }

export function remarkLocalRasterImages() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode): void => {
      if (node.type === "image" && typeof node.url === "string") {
        node.url = nativeImageUrl(node.url) ?? node.url
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

/** Absolute raster paths are handled by Bodhi, never by the browser's URL loader. */
export function localImagePath(url: string): string | null {
  let path: string
  try {
    path = decodeURIComponent(url.startsWith(NATIVE_IMAGE_PREFIX)
      ? url.slice(NATIVE_IMAGE_PREFIX.length) : url)
  } catch { return null }
  if (!supportedNativePath(path)) return null
  // Keep ordinary frontend asset URLs working as normal web images.
  if (!url.startsWith(NATIVE_IMAGE_PREFIX) && /^\/(?:assets|images|icons|api)\//.test(path)) return null
  return path
}

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
