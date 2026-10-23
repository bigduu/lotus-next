import { expect, it, vi } from "vitest"
import { navigateRecordedSession } from "./recordedSessionNavigation"
const ports = () => ({ isCurrent: vi.fn(() => true), restore: vi.fn(async () => true), select: vi.fn(), notFound: () => new Error("Recorded Session is missing") })
it("opens exactly the recorded existing Session after verification and restoration", async () => {
  const navigation = ports()
  expect(await navigateRecordedSession("exact-session", async () => true, navigation)).toBe(true)
  expect(navigation.restore).toHaveBeenCalledExactlyOnceWith("exact-session")
  expect(navigation.select).toHaveBeenCalledExactlyOnceWith("exact-session")
})
it("does not restore or close the details when access is no longer available", async () => {
  const navigation = ports()
  expect(await navigateRecordedSession("exact-session", async () => false, navigation)).toBe(false)
  expect(navigation.restore).not.toHaveBeenCalled(); expect(navigation.select).not.toHaveBeenCalled()
})
it("discards late access after another intent even if the Session ID is unchanged", async () => {
  let intent = 1
  let finish!: (value: boolean) => void
  const navigation = { ...ports(), isCurrent: () => intent === 1 }
  const opening = navigateRecordedSession("same-session", () => new Promise((resolve) => { finish = resolve }), navigation)
  intent += 1; finish(true)
  expect(await opening).toBe(false)
  expect(navigation.restore).not.toHaveBeenCalled(); expect(navigation.select).not.toHaveBeenCalled()
})
it.each([true, false])("discards late restoration result %s after another intent", async (result) => {
  let current = true
  let finish!: (value: boolean) => void
  const navigation = { ...ports(), isCurrent: () => current, restore: vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve })) }
  const opening = navigateRecordedSession("old-session", async () => true, navigation)
  await Promise.resolve()
  current = false; finish(result)
  expect(await opening).toBe(false)
  expect(navigation.select).not.toHaveBeenCalled()
})
it("reports a missing existing Session without creating a replacement", async () => {
  const navigation = ports(); navigation.restore.mockResolvedValue(false)
  await expect(navigateRecordedSession("deleted-session", async () => true, navigation)).rejects.toThrow("Recorded Session is missing")
  expect(navigation.select).not.toHaveBeenCalled()
})
