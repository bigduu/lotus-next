import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { McpImportFailure } from "@services/mcp/importConfig"
import { McpImportDialog, type McpImportCompletion } from "./McpImportDialog"

const roots: Root[] = []
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
const source = JSON.stringify({ mcpServers: { incoming: { command: "fixture", disabled: true, env: { TOKEN: "PRIVATE_IMPORT_MARKER" } } } })
const result: McpImportCompletion = { result: { mode: "merge", added: 1, updated: 0, removed: 0, server_ids: ["incoming"] }, refreshed: true }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const button = (text: string) => [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === text)!
const click = async (text: string) => act(async () => { button(text).click() })
const check = async () => act(async () => { document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
const mode = async (value: "merge" | "replace") => act(async () => { document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!.click() })
const fill = async (value = source) => act(async () => {
  const input = document.querySelector("textarea")!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
})
const file = async (pending: Promise<string>, name = "import.json") => act(async () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const selected = new File(["fixture"], name, { type: "application/json" })
  Object.defineProperty(selected, "text", { value: () => pending })
  Object.defineProperty(input, "files", { configurable: true, value: [selected] })
  input.dispatchEvent(new Event("change", { bubbles: true }))
})
async function mount(overrides: Partial<ComponentProps<typeof McpImportDialog>> = {}) {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  const props = {
    existingIds: ["existing", "keep"], listConfirmed: true, listRevision: 1,
    onClose: vi.fn(() => root.render(null)), onReturnFocus: vi.fn(),
    onImport: vi.fn().mockResolvedValue(result), onReload: vi.fn().mockResolvedValue(true), ...overrides,
  }
  const render = async (next = props) => act(async () => { root.render(<McpImportDialog {...next} />) })
  await render()
  return { props, render, root }
}
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

describe("McpImportDialog", () => {
  it("defaults to Merge, previews only safe metadata, and reports authoritative counts", async () => {
    const storage = vi.spyOn(localStorage, "setItem")
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")]
    const { props } = await mount()
    expect(document.querySelector<HTMLInputElement>('input[value="merge"]')?.checked).toBe(true)
    expect(document.activeElement).toBe(button("取消"))
    expect(button("导入").disabled).toBe(true)
    await fill()
    const preview = document.querySelector('[aria-label="导入预览"]')!
    expect(preview.textContent).toContain("incoming")
    expect(preview.textContent).not.toContain("PRIVATE_IMPORT_MARKER")
    expect(document.body.textContent).toContain("不递归合并字段")
    await click("导入")
    expect(props.onImport).toHaveBeenCalledExactlyOnceWith({ ...JSON.parse(source), mode: "merge" }, expect.any(String))
    // The explicit mode belongs to the API payload, not the pasted root object.
    expect(vi.mocked(props.onImport).mock.calls[0][0].mode).toBe("merge")
    expect(document.querySelector('[aria-label="导入结果"]')?.textContent).toContain("新增 1 · 更新 0 · 删除 0")
    expect(document.body.textContent).not.toContain("PRIVATE_IMPORT_MARKER")
    expect(storage.mock.calls.flat().join(" ")).not.toContain("PRIVATE_IMPORT_MARKER")
    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_IMPORT_MARKER")
  })

  it("binds Replace confirmation to input, mode and inventory revision, including changes back to an old ID set", async () => {
    const { props, render } = await mount()
    await fill(); await mode("replace")
    expect(document.querySelector('[aria-label="将删除的服务器"]')?.textContent).toContain("keep")
    expect(button("导入").disabled).toBe(true)
    await check(); expect(button("导入").disabled).toBe(false)
    await fill(`${source} `); expect(button("导入").disabled).toBe(true)
    await check(); await mode("merge"); await mode("replace"); expect(button("导入").disabled).toBe(true)
    await check(); await render({ ...props, existingIds: [...props.existingIds, "another"], listRevision: 2 })
    expect(button("导入").disabled).toBe(true)
    await render({ ...props, listRevision: 3 }); expect(button("导入").disabled).toBe(true)
    expect(props.onImport).not.toHaveBeenCalled()
  })

  it("requires explicit Replace confirmation even when no IDs will be removed", async () => {
    const { props } = await mount({ existingIds: [] })
    await fill(); await mode("replace")
    expect(button("导入").disabled).toBe(true)
    await check(); await click("导入")
    expect(props.onImport).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.onImport).mock.calls[0][0].mode).toBe("replace")
  })

  it("fences rapid submit/dismiss and ignores programmatic draft edits during the request", async () => {
    const pending = deferred<McpImportCompletion>()
    const onImport = vi.fn().mockReturnValue(pending.promise)
    const { props } = await mount({ onImport })
    await fill()
    await act(async () => { button("导入").click(); button("导入").click() })
    await fill('{"mcpServers":{"other":{"command":"other"}}}')
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    expect(onImport).toHaveBeenCalledTimes(1); expect(props.onClose).not.toHaveBeenCalled()
    expect(button("取消").disabled).toBe(true)
    await act(async () => { pending.resolve(result) })
    expect(document.querySelector('[aria-label="导入结果"]')?.textContent).toContain("incoming")
  })

  it("lets typed input supersede a pending file and discards files after closing/reopening", async () => {
    const { props, render } = await mount()
    const oldFile = deferred<string>(); await file(oldFile.promise)
    expect(button("导入").disabled).toBe(true)
    await fill()
    await act(async () => { oldFile.resolve('{"mcpServers":{"old":{"command":"old"}}}') })
    expect(document.querySelector("textarea")?.value).toBe(source)
    const closingFile = deferred<string>(); await file(closingFile.promise)
    await click("取消"); await render()
    await act(async () => { closingFile.resolve(source) })
    expect(document.querySelector("textarea")?.value).toBe("")
    expect(props.onImport).not.toHaveBeenCalled()
  })

  it("accepts only the latest selected file and invalidates an existing Replace confirmation", async () => {
    await mount(); await fill(); await mode("replace"); await check()
    const first = deferred<string>(); const second = deferred<string>()
    await file(first.promise); await file(second.promise, "newer.json")
    await act(async () => { second.resolve(source) })
    await act(async () => { first.resolve('{"mcpServers":{"old":{"command":"old"}}}') })
    expect(document.querySelector("textarea")?.value).toBe(source)
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(button("导入").disabled).toBe(true)
  })

  it("does not expose parser details or allow invalid JSON to mutate", async () => {
    const { props } = await mount()
    await fill('{"mcpServers": PRIVATE_IMPORT_MARKER}')
    expect(document.querySelector('[role="alert"]')?.textContent).not.toContain("PRIVATE_IMPORT_MARKER")
    expect(button("导入").disabled).toBe(true); expect(props.onImport).not.toHaveBeenCalled()
  })

  it("keeps uncertain outcomes distinct from success and permits only read refresh until a new intent", async () => {
    const onImport = vi.fn().mockRejectedValue(new McpImportFailure("uncertain"))
    const { props } = await mount({ onImport })
    await fill(); await click("导入")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("配置可能已更新")
    expect(button("导入").disabled).toBe(true)
    expect(document.querySelector('[aria-label="导入结果"]')).toBeNull()
    await click("刷新当前列表")
    expect(props.onReload).toHaveBeenCalledTimes(1); expect(onImport).toHaveBeenCalledTimes(1)
    expect(button("导入").disabled).toBe(true)
  })

  it("discards a late completed import after unmount rather than applying it to a new dialog", async () => {
    const pending = deferred<McpImportCompletion>()
    const { root, render } = await mount({ onImport: vi.fn().mockReturnValue(pending.promise) })
    await fill(); await click("导入")
    await act(async () => { root.render(null) }); await render()
    await act(async () => { pending.resolve(result) })
    expect(document.querySelector("textarea")?.value).toBe("")
    expect(document.querySelector('[aria-label="导入结果"]')).toBeNull()
  })
});
