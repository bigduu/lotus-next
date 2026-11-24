import { createSignal, onSettled, untrack } from "solid-js"

/** Pane-owned event state whose current value is read synchronously by identity fences. */
export function cell<T>(current: T) {
  return { current }
}

/** Keep the same synchronous ownership checks while invalidating Solid projections. */
export function createObservableCell<T>(current: T) {
  const [version, setVersion] = createSignal(0)
  const touch = () => setVersion((value) => value + 1)
  return {
    touch,
    get current() {
      version()
      return current
    },
    set current(next: T) {
      if (Object.is(next, current)) return
      current = next
      touch()
    },
  }
}

export function createExternalSnapshot<T>(subscribe: (onChange: () => void) => () => void, read: () => T) {
  const [snapshot, setSnapshot] = createSignal({ current: untrack(read) })
  onSettled(() => {
    const update = () => {
      const current = read()
      setSnapshot((previous) => Object.is(previous.current, current) ? previous : { current })
    }
    const unsubscribe = subscribe(update)
    update()
    return unsubscribe
  })
  return () => snapshot().current
}
