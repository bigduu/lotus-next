import { expect, it } from "vitest"
import { pointInBrowserFrame } from "./browserFrame"

const frame = {
  blob: new Blob(),
  frame_seq: 1,
  page_epoch: 1,
  viewport: { width: 800, height: 600 },
}

it("maps clicks through the letterboxed screenshot and ignores its margins", () => {
  const imageRect = { left: 10, top: 20, width: 400, height: 400 }
  expect(pointInBrowserFrame(110, 120, imageRect, frame)).toEqual({ x: 200, y: 100 })
  expect(pointInBrowserFrame(110, 40, imageRect, frame)).toBeNull()
  expect(pointInBrowserFrame(411, 120, imageRect, frame)).toBeNull()
})
