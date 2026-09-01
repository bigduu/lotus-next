import mermaid, { type MermaidConfig } from "mermaid"

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }

  return value as DeepReadonly<T>
}

/**
 * Security invariants shared by every Mermaid renderer in Lotus Next.
 *
 * Keep this application-owned: model/diagram input must never be forwarded to
 * Mermaid's global configuration APIs. The object and its nested values are
 * frozen so a renderer cannot silently weaken the policy for another surface.
 */
export const MERMAID_STRICT_CONFIG = deepFreeze({
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: {
    htmlLabels: false,
  },
} as const satisfies MermaidConfig)

type MermaidSurface = "app" | "export"

const MERMAID_SURFACE_CONFIGS = deepFreeze({
  app: {
    ...MERMAID_STRICT_CONFIG,
    theme: "dark",
  },
  export: {
    ...MERMAID_STRICT_CONFIG,
    theme: "default",
  },
} as const satisfies Record<MermaidSurface, MermaidConfig>)

/** Initialize Mermaid from a closed set of trusted, recursively frozen configs. */
export function initializeTrustedMermaid(surface: MermaidSurface): void {
  mermaid.initialize(MERMAID_SURFACE_CONFIGS[surface])
}
