import { afterEach, beforeEach, vi } from "vitest"

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

const localStorageForTests = createMemoryStorage()
const sessionStorageForTests = createMemoryStorage()

const bindStorage = (name: "localStorage" | "sessionStorage", storage: Storage) => {
  // Node 26 exposes experimental storage accessors that evaluate to undefined
  // without a process-level storage file, and those accessors can shadow
  // jsdom's Window storage. Install deterministic per-worker browser storage
  // explicitly; this also keeps tests isolated on supported CI Node versions.
  Object.defineProperty(globalThis, name, { configurable: true, value: storage })
  Object.defineProperty(window, name, { configurable: true, value: storage })
}

bindStorage("localStorage", localStorageForTests)
bindStorage("sessionStorage", sessionStorageForTests)

beforeEach(() => {
  localStorageForTests.clear()
  sessionStorageForTests.clear()
})

afterEach(() => {
  vi.useRealTimers()
})
