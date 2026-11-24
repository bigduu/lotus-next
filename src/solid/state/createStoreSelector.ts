import { createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import type { StoreApi } from "zustand/vanilla"

/** Subscribe at the Solid owner and preserve selector identity across unrelated updates. */
export function createStoreSelector<State extends object, Selected>(
  store: Pick<StoreApi<State>, "getState" | "subscribe">,
  select: (state: State) => Selected,
  equals: (previous: Selected, next: Selected) => boolean = Object.is,
): Accessor<Selected> {
  const [snapshot, setSnapshot] = createSignal({ state: store.getState() })

  onSettled(() => {
    const unsubscribe = store.subscribe((next) => setSnapshot({ state: next }))
    // Catch writes between component setup and subscription installation.
    setSnapshot({ state: store.getState() })
    return unsubscribe
  })

  return createMemo(() => select(snapshot().state), { equals })
}
