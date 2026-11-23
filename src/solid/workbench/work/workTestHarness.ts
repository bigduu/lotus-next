import { flush } from "solid-js"

const scheduleTurn = setTimeout

export function flushWorkTest(action: () => unknown) {
  const result = action()
  flush()
  return result
}

export async function settleWorkTest(action: () => unknown = () => undefined) {
  await flushWorkTest(action)
  // The fixture can advance polling independently of awaited requests.
  await new Promise<void>((resolve) => scheduleTurn(resolve, 0))
  flush()
}
