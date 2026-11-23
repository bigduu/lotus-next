import { bindReactStore } from "./bindReactStore"
import { settingsViewStore } from "./settingsViewState"

export * from "./settingsViewState"
export const useSettingsViewStore = bindReactStore(settingsViewStore)
