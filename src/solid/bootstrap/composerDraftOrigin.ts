import { createContext, useContext } from "solid-js"

export const ComposerDraftOriginContext = createContext<() => string | null>(() => null)

export const useComposerDraftOrigin = () => useContext(ComposerDraftOriginContext)
