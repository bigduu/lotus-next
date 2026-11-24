import { useStore, type UseBoundStore } from "zustand"
import type { ExtractState, StoreApi } from "zustand/vanilla"

type ReadableStore = Pick<StoreApi<unknown>, "getState" | "getInitialState" | "subscribe">

/** Attach a React hook to the same vanilla store used by services and Solid. */
export function bindReactStore<S extends ReadableStore>(store: S): UseBoundStore<S> {
  type State = ExtractState<S>
  const identity = (state: State) => state

  function useBoundStore(): State
  function useBoundStore<T>(selector: (state: State) => T): T
  function useBoundStore<T>(selector?: (state: State) => T): State | T {
    return useStore<S, State | T>(store, selector ?? identity)
  }

  return Object.assign(useBoundStore, store)
}
