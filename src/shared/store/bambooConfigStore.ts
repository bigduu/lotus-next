import { bindReactStore } from "./bindReactStore"
import { bambooConfigStore } from "./bambooConfigState"

export * from "./bambooConfigState"
export const useBambooConfigStore = bindReactStore(bambooConfigStore)
