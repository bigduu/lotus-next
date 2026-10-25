import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient, SessionPermissionContractError, type SessionPermissionSnapshot, type SessionSummary } from "@services/chat/AgentService"
import { ApiError, NetworkRequestError, RequestTimeoutError } from "@services/api"
import { useAppStore } from "@shared/store/appStore"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { useNewSessionPermission } from "@shared/store/newSessionPermission"
import i18n, { changeLocale, i18nReady } from "@shared/i18n"
import { NewSessionPermissionControl, PermissionModeControl } from "./PermissionModeControl"

const read = vi.fn<typeof agentClient.getSessionPermissionMode>()
const patch = vi.fn<typeof agentClient.patchSessionPermissionMode>()
const roots: Root[] = []
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const snapshot = (mode: SessionPermissionSnapshot["mode"] = "default", etag = '"7"', sessionId = "a"): SessionPermissionSnapshot => ({ mode, etag, sessionId })
const summary = (id: string): SessionSummary => ({
  id, kind: "root", title: `Session ${id}`, title_version: 0, pinned: false,
  root_session_id: id, spawn_depth: 0, model: "fixture-model",
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
  last_activity_at: "2026-09-06T00:00:00Z", message_count: 0,
  has_attachments: false, is_running: false, permission_mode: "default",
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const selector = () => {
  const select = document.querySelector<HTMLButtonElement>('[role="combobox"]')
  if (!select) throw new Error("Permission mode selector is missing")
  return select
}
const button = (name: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === name)
  if (!found) throw new Error(`Button ${name} is missing`)
  return found
}
const openOptions = () => act(() => {
  selector().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
})
const choose = (mode: string) => {
  if (selector().disabled) return
  openOptions()
  act(() => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent?.toLowerCase() === mode)
    if (!option) throw new Error(`Permission option ${mode} is missing`)
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
}
const selectedMode = () => {
  const text = selector().textContent?.toLowerCase() ?? ""
  return ["default", "bypass", "auto"].includes(text) ? text : ""
}
const click = (name: string) => act(() => button(name).click())
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
async function mount(id = "a", compact = false) {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const render = async (sessionId: string) => act(async () => {
    root.render(<PermissionModeControl sessionId={sessionId} title={`Session ${sessionId}`} compact={compact} />)
  })
  await render(id)
  return { render }
}

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
  await i18nReady; await changeLocale("en-US")
  useAppStore.getState().resetSessionPermissionModes()
  useAppStore.setState({ chats: [summary("a"), summary("b")].map(sessionSummaryToChatItem), currentSessionId: "a" })
  read.mockReset().mockImplementation(async (id) => snapshot("default", '"7"', id))
  patch.mockReset()
  vi.spyOn(agentClient, "getSessionPermissionMode").mockImplementation(read)
  vi.spyOn(agentClient, "patchSessionPermissionMode").mockImplementation(patch)
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  useAppStore.getState().resetSessionPermissionModes()
  document.body.replaceChildren()
})

describe("PermissionModeControl", () => {
  it("reads permissions when the selected session arrives after the composer mounts", async () => {
    useAppStore.setState({ chats: [] })
    await mount("a", true)
    expect(read).not.toHaveBeenCalled()
    expect(selector().textContent).not.toContain("Checking")
    await act(async () => {
      useAppStore.setState({ chats: [sessionSummaryToChatItem(summary("a"))] })
    })
    await flush()
    expect(read).toHaveBeenCalledExactlyOnceWith("a")
    expect(selectedMode()).toBe("default")
    expect(selector().disabled).toBe(false)
  })

  it("uses the compact composer presentation without dropping its accessible help", async () => {
    await mount("a", true)
    const section = document.querySelector("section")
    const helpId = selector().getAttribute("aria-describedby")?.split(" ")[0]
    const help = document.getElementById(helpId ?? "")

    expect(section?.dataset.variant).toBe("composer")
    expect(help?.className).toContain("sr-only")
    expect(section?.getAttribute("title")).toBe(help?.textContent)
    expect(selector().tagName).toBe("BUTTON")
    expect(selector().dataset.slot).toBe("select-trigger")
    expect(selector().querySelector(".lucide-shield-alert")).not.toBeNull()
  })

  it("opens themed options with the keyboard and cancels without changing permissions", async () => {
    await mount("a", true)
    act(() => selector().focus())
    openOptions()
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!
    expect(list.dataset.slot).toBe("select-content")
    expect(list.className).toContain("bg-popover")
    expect(list.className).toContain("text-popover-foreground")
    expect([...list.querySelectorAll('[role="option"]')].map((item) => item.textContent)).toEqual(["Default", "Bypass", "Auto"])
    expect(list.querySelector('[data-state="checked"]')?.textContent).toBe("Default")
    act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await flush()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(selector()))
    expect(selectedMode()).toBe("default")
    expect(patch).not.toHaveBeenCalled()
  })

  it("uses the same themed choices for the next session without mutating existing sessions", async () => {
    const refresh = vi.fn(async () => {})
    const originalRefresh = useNewSessionPermission.getState().refresh
    useNewSessionPermission.setState({ mode: "bypass", refresh })
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    try {
      await act(async () => root.render(<NewSessionPermissionControl />))
      expect(selectedMode()).toBe("bypass")
      expect(refresh).toHaveBeenCalledOnce()
      choose("default")
      expect(useNewSessionPermission.getState().mode).toBe("default")
      choose("auto")
      expect(selectedMode()).toBe("auto")
      expect(useNewSessionPermission.getState().mode).toBe("auto")
      expect(patch).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    } finally {
      useNewSessionPermission.setState({ mode: "default", refresh: originalRefresh })
    }
  })

  it.each(["en-US", "zh-CN"] as const)("registers all permission copy in the actual %s chat namespace", async (locale) => {
    await changeLocale(locale)
    for (const key of ["section", "label", "loading", "saving", "unavailable", "unconfirmed", "refresh", "readRequired",
      "help.default", "help.bypass", "help.auto", "confirmTitle", "confirmDescription", "confirm", "cancel",
      "errors.conflict", "errors.rejected", "errors.ambiguous", "errors.unsupported", "errors.unconfirmed", "errors.timeout", "errors.stale", "errors.changed"]) {
      expect(i18n.getResource(locale, "translation", `chat.permissionMode.${key}`)).toEqual(expect.any(String))
    }
  })

  it("starts unavailable until a detail GET confirms support, mode and ETag", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); read.mockReturnValueOnce(pending.promise)
    await mount()
    expect(selector().getAttribute("aria-label")).toBe("Permission mode")
    expect(selector().disabled).toBe(true); expect(selectedMode()).toBe("")
    expect(patch).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(snapshot()); await pending.promise })
    expect(selector().disabled).toBe(false); expect(selectedMode()).toBe("default")
  })

  it("makes missing/unknown typed support visibly unavailable instead of inferring Auto", async () => {
    read.mockRejectedValueOnce(new SessionPermissionContractError())
    await mount()
    expect(selector().disabled).toBe(true); expect(selectedMode()).toBe("")
    expect(selector().textContent).toBe("Unavailable")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("never interpreted as Auto")
    expect(patch).not.toHaveBeenCalled()
  })

  it("shows timeout and retry visibly in the compact composer, then confirms the mode", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); read.mockReturnValueOnce(pending.promise)
    await mount("a", true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Checking session permissions")
    await act(async () => { pending.reject(new RequestTimeoutError()); await Promise.resolve(); await Promise.resolve() })
    const error = document.querySelector<HTMLElement>('[role="alert"]')!
    expect(error.textContent).toContain("timed out")
    expect(error.className).not.toContain("sr-only")
    expect(selector().disabled).toBe(true)
    read.mockResolvedValueOnce(snapshot())
    await click("Refresh mode"); await flush()
    expect(selectedMode()).toBe("default")
    expect(error.isConnected).toBe(false)
  })

  it("keeps unsupported errors visible in the compact composer", async () => {
    read.mockRejectedValueOnce(new SessionPermissionContractError())
    await mount("a", true)
    const error = document.querySelector<HTMLElement>('[role="alert"]')!
    expect(error.textContent).toContain("never interpreted as Auto")
    expect(error.className).not.toContain("sr-only")
    expect(button("Refresh mode")).toBeTruthy()
  })

  it("keeps the confirmed mode selected while saving and retains forced-confirmation Bypass copy", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise)
    await mount(); choose("bypass")
    await flush()
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "bypass", '"7"')
    expect(selectedMode()).toBe("default"); expect(selector().disabled).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Saving mode…")
    await act(async () => { pending.resolve(snapshot("bypass", '"8"')); await pending.promise })
    expect(selectedMode()).toBe("bypass"); expect(selector().disabled).toBe(false)
    expect(document.body.textContent).toContain("forced confirmations still ask")
  })

  it("requires a current-session Auto confirmation and puts initial focus on Cancel", async () => {
    await mount(); choose("auto"); await flush()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("Enable Auto for this session?")
    expect(dialog?.textContent).toContain("Session a")
    expect(dialog?.textContent).toContain("Plan/Guardian")
    expect(document.activeElement).toBe(button("Cancel"))
    expect(patch).not.toHaveBeenCalled(); expect(selectedMode()).toBe("default")
    click("Cancel"); await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(selector())); expect(patch).not.toHaveBeenCalled()
  })

  it("sends Auto once only after explicit confirmation, without a Boolean write", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise)
    await mount(); choose("auto"); click("Enable Auto"); choose("bypass")
    await flush()
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"7"')
    expect(selector().disabled).toBe(true)
    await act(async () => { pending.resolve(snapshot("auto", '"8"')); await pending.promise })
    expect(selectedMode()).toBe("auto")
    expect(document.body.textContent).toContain("no approval prompts, including forced confirmations")
    expect(document.body.textContent).toContain("OS/sandbox limits still apply")
  })

  it("supports Escape cancellation and restores keyboard focus without sending", async () => {
    await mount(); choose("auto"); await flush()
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(selector())); expect(patch).not.toHaveBeenCalled()
  })

  it("keeps the confirmed Auto intent when preflight only advances the metadata revision", async () => {
    await mount()
    read.mockResolvedValueOnce(snapshot("default", '"8"'))
    patch.mockResolvedValueOnce(snapshot("auto", '"9"'))
    choose("auto"); click("Enable Auto"); await flush()
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"8"')
    expect(read).toHaveBeenCalledTimes(2)
    expect(selectedMode()).toBe("auto"); expect(selector().disabled).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("shows a changed preflight mode and asks for re-selection without sending the confirmed Auto intent", async () => {
    await mount()
    read.mockResolvedValueOnce(snapshot("bypass", '"8"'))
    choose("auto"); click("Enable Auto"); await flush()
    expect(patch).not.toHaveBeenCalled()
    expect(selectedMode()).toBe("bypass"); expect(selector().disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("changed while you were choosing")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("shows the 412 winner with an error and no extra PATCH", async () => {
    await mount()
    patch.mockRejectedValueOnce(new ApiError("Conflict", 412, "Precondition Failed"))
    read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot("auto", '"9"'))
    choose("bypass"); await flush()
    expect(selectedMode()).toBe("auto"); expect(selector().disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("session changed elsewhere")
    expect(patch).toHaveBeenCalledTimes(1)
  })

  it("clearly disables an ambiguous write plus failed read, and refresh only reads", async () => {
    await mount()
    patch.mockRejectedValueOnce(new NetworkRequestError())
    read.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new NetworkRequestError())
    choose("auto"); click("Enable Auto"); await flush()
    expect(selector().disabled).toBe(true); expect(selectedMode()).toBe("")
    expect(selector().textContent).toBe("Unconfirmed")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("current permission mode could not be confirmed")
    read.mockResolvedValueOnce(snapshot("auto", '"8"'))
    click("Refresh mode"); await flush()
    expect(selector().disabled).toBe(false); expect(selectedMode()).toBe("auto")
    expect(patch).toHaveBeenCalledTimes(1)
  })

  it("does not display session A's late mutation in session B", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise)
    const { render } = await mount(); choose("auto"); click("Enable Auto")
    await render("b")
    expect(selectedMode()).toBe("default"); expect(selector().disabled).toBe(false)
    await act(async () => { pending.resolve(snapshot("auto", '"8"')); await pending.promise })
    expect(selectedMode()).toBe("default")
    expect(useAppStore.getState().chats.find((chat) => chat.id === "a")?.config.permissionMode).toBe("auto")
    expect(patch.mock.calls).toEqual([["a", "auto", '"7"']])
  })

  it("discards an unaccepted confirmation on session switches, including switching back", async () => {
    const { render } = await mount(); choose("auto")
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await render("b"); await render("a")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(selectedMode()).toBe("default"); expect(patch).not.toHaveBeenCalled()
  })

  it("invalidates the Auto dialog if the authoritative ETag changes before confirmation", async () => {
    await mount(); choose("auto")
    read.mockResolvedValueOnce(snapshot("bypass", '"8"'))
    await act(async () => { await useAppStore.getState().refreshSessionPermissionMode("a") })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(selectedMode()).toBe("bypass"); expect(patch).not.toHaveBeenCalled()
  })

  it("localizes risk and error text while keeping all three explicit mode names", async () => {
    await changeLocale("zh-CN")
    await mount(); choose("auto")
    expect(selector().getAttribute("aria-label")).toBe("权限模式")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("为当前会话启用 Auto？")
    expect(button("启用 Auto")).toBeTruthy(); expect(button("取消")).toBeTruthy()
  })
})
