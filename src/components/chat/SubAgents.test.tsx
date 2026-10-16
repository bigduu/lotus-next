import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { SubAgents } from "./SubAgents"

it.each([
  ["completed", "done_c0b3fbff"],
  ["error", "failed_28384d7a"],
  ["cancelled", "workflow_run_status_cancelled"],
  ["retired", "exited_899df7e2"],
  ["unknown", "plugin_connection_unknown"],
] as const)("renders %s without an active spinner", (status, label) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div")
  const root = createRoot(host)
  try {
    act(() => root.render(<SubAgents agents={{ child: { title: "Reviewer", status } }} />))
    expect(host.textContent).toContain(uiText(label))
    expect(host.querySelector(".animate-spin")).toBeNull()
  } finally { act(() => root.unmount()) }
})
