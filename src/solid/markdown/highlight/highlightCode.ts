import { bundledLanguages, bundledLanguagesInfo, createHighlighter, type BundledLanguage, type ThemedToken } from "shiki"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

export type HighlightedCode = readonly (readonly ThemedToken[])[]

const themes = { light: "github-light", dark: "github-dark-default" } as const
const engine = createJavaScriptRegexEngine({ forgiving: true })
const aliases = new Map(bundledLanguagesInfo.flatMap(({ id, aliases }) => aliases?.map((alias) => [alias, id] as const) ?? []))

let highlighterRequest: ReturnType<typeof createHighlighter> | undefined
const grammars = new Map<BundledLanguage, Promise<void>>()
const results = new Map<string, Promise<HighlightedCode>>()
const maxCachedBlocks = 64
const maxCachedLength = 16_384

function getHighlighter() {
  if (!highlighterRequest) {
    const request = createHighlighter({ themes: [themes.light, themes.dark], langs: [], engine })
    highlighterRequest = request
    void request.catch(() => { if (highlighterRequest === request) highlighterRequest = undefined })
  }
  return highlighterRequest
}

async function tokenize(code: string, language: BundledLanguage | "text") {
  const highlighter = await getHighlighter()
  if (language !== "text") {
    let grammar = grammars.get(language)
    if (!grammar) {
      grammar = highlighter.loadLanguage(language)
      grammars.set(language, grammar)
      void grammar.catch(() => { if (grammars.get(language) === grammar) grammars.delete(language) })
    }
    await grammar
  }
  return highlighter.codeToTokens(code, { lang: language, themes }).tokens
}

export function highlightCode(code: string, fenceLanguage: string): Promise<HighlightedCode> {
  const normalized = fenceLanguage.trim().toLowerCase()
  const canonical = aliases.get(normalized) ?? normalized
  const language = Object.hasOwn(bundledLanguages, canonical) ? canonical as BundledLanguage : "text"
  const key = code.length <= maxCachedLength ? `${language}\0${code}` : null
  const cached = key === null ? undefined : results.get(key)
  if (cached && key !== null) {
    results.delete(key)
    results.set(key, cached)
    return cached
  }

  const request = tokenize(code, language)
  if (key !== null) {
    // Preserve exact content identity when only the middle of a block changes.
    results.set(key, request)
    if (results.size > maxCachedBlocks) results.delete(results.keys().next().value!)
    void request.catch(() => { if (results.get(key) === request) results.delete(key) })
  }
  return request
}
