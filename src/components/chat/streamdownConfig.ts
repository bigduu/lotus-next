import type { CodeHighlighterPlugin, ThemeInput } from "streamdown"

export const STREAMDOWN_THEMES: [ThemeInput, ThemeInput] = ["github-light", "github-dark-default"]

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

export { localImagePath, nativeImageUrl, remarkLocalRasterImages, safeAssistantUrlTransform } from "@/lib/assistantMarkdownSafety"
