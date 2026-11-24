import { bindReactStore } from "../../bindReactStore"
import { providerStore } from "./providerState"

export * from "./providerState"
export const useProviderStore = bindReactStore(providerStore)
