import { renderMermaid as render } from "./renderMermaid"

// Keep a separate entry URL while using the same Mermaid instance and render queue.
export function renderMermaid(...args: Parameters<typeof render>) {
  return render(...args)
}
