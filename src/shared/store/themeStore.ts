import { useStore } from "zustand"
import { themeStore, type ThemeState } from "./themeState"

const selectThemeState = (state: ThemeState) => state

function useThemeState(): ThemeState
function useThemeState<T>(selector: (state: ThemeState) => T): T
function useThemeState<T>(selector?: (state: ThemeState) => T): ThemeState | T {
  return useStore<typeof themeStore, ThemeState | T>(themeStore, selector ?? selectThemeState)
}

export const useThemeStore = Object.assign(useThemeState, themeStore)
