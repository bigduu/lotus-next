import { createRequire } from "node:module"
import { vi } from "vitest"

const require = createRequire(import.meta.url)

/** Use Kobalte's compiled Solid entry in unit tests, where dependency JSX is external. */
export function compiledKobalte(name: string) {
  return vi.importActual(require.resolve(`@kobalte/core/${name}`).replace(/\.jsx$/, ".js"))
}
