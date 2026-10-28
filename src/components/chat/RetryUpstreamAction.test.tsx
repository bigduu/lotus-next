import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const capability = vi.hoisted(() => vi.fn())
vi.mock("@services/chat/upstreamRetry", () => ({supportsContinuousUpstreamRetry:capability}))
import { RetryUpstreamAction } from "./RetryUpstreamAction"
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root: Root
beforeEach(() => {capability.mockReset();root=createRoot(document.body.appendChild(document.createElement("div")))})
afterEach(() => {act(() => root.unmount());document.body.replaceChildren()})
it.each([false,true])("renders a button only when support is %s", async (supported) => {
  capability.mockResolvedValue(supported);const retry=vi.fn()
  await act(async () => root.render(<RetryUpstreamAction disabled={false} onRetry={retry}/>))
  expect(document.querySelectorAll("button")).toHaveLength(supported?1:0)
  if(supported) {await act(async()=>document.querySelector("button")!.click());expect(retry).toHaveBeenCalledTimes(1)}
  else expect(retry).not.toHaveBeenCalled()
})
it("keeps unavailable/loading states silent and performs no retry",async()=>{
  let reject!:(reason:Error)=>void
  capability.mockReturnValue(new Promise((_,r)=>{reject=r}));const retry=vi.fn()
  await act(async()=>root.render(<RetryUpstreamAction disabled={false} onRetry={retry}/>))
  expect(document.body.textContent).toBe("")
  await act(async()=>reject(new Error("PRIVATE_CANARY")))
  expect(document.body.textContent).toBe("");expect(retry).not.toHaveBeenCalled()
})
it("does not dispatch through a disabled action",async()=>{
  capability.mockResolvedValue(true);const retry=vi.fn()
  await act(async()=>root.render(<RetryUpstreamAction disabled onRetry={retry}/>))
  await act(async()=>document.querySelector("button")!.click())
  expect(retry).not.toHaveBeenCalled()
})
