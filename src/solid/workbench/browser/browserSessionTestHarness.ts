import { createRoot, createSignal, flush } from "solid-js"
import { createBrowserSession } from "./createBrowserSession"

const scheduleTurn = setTimeout

export async function settleBrowser(action: () => unknown) {
  const result = action()
  flush()
  await result
  // Drain the asynchronous reads and writes even when polling timers are faked.
  await new Promise<void>((resolve) => scheduleTurn(resolve, 0))
  flush()
}

export function createBrowserSessionHarness(defaultSessionId: string) {
  return createRoot((dispose) => {
    const [scope, setScope] = createSignal<{ sessionId: string | null; active: boolean }>({ sessionId: null, active: false })
    const browser = createBrowserSession(() => scope().sessionId, () => scope().active)
    return {
      browser,
      show: (sessionId = defaultSessionId, active = true) => settleBrowser(() => setScope({ sessionId, active })),
      dispose,
    }
  })
}
