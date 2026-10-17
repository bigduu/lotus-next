import { useRef, useState } from "react"
import type { WorkRequestReceipt } from "./projectWorkControls"

/** Only guards event delivery. Authoritative pending/ACK/state always comes from props. */
export function useWorkRequestGuard(activeOperationIds: readonly string[]) {
  const sent = useRef(new Set<string>())
  const inFlight = useRef<string | null>(null)
  const [local, setLocal] = useState<{ operationId: string; phase: "submitting" | "uncertain" } | null>(null)
  const send = async (operationId: string, callback: () => Promise<WorkRequestReceipt>) => {
    if (activeOperationIds.some((id) => sent.current.has(id))
      || (inFlight.current !== null && activeOperationIds.includes(inFlight.current))) return
    sent.current.add(operationId)
    inFlight.current = operationId
    setLocal({ operationId, phase: "submitting" })
    try {
      const receipt = await callback()
      // A receipt is only delivery evidence. It never changes Work or runtime state.
      if (receipt.operationId !== operationId) throw new Error("Mismatched operation receipt")
      setLocal((current) => current?.operationId === operationId ? null : current)
    } catch {
      setLocal((current) => current?.operationId === operationId ? { operationId, phase: "uncertain" } : current)
    } finally {
      if (inFlight.current === operationId) inFlight.current = null
    }
  }
  const relevant = !!local && activeOperationIds.includes(local.operationId)
  return { send, sent: (operationId?: string) => !!operationId && sent.current.has(operationId),
    operationId: relevant ? local.operationId : null,
    submitting: relevant && local.phase === "submitting", uncertain: relevant && local.phase === "uncertain" }
}
