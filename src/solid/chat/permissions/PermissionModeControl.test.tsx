import { createSignal, Show } from "solid-js"
import { render, type JSX } from "@solidjs/web"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient, SessionPermissionContractError, type SessionPermissionSnapshot, type SessionSummary } from "@services/chat/AgentService"
import { ApiError, NetworkRequestError, RequestTimeoutError } from "@services/api"
import { appStore } from "@shared/store/appStore/state"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { newSessionPermissionStore } from "@shared/store/newSessionPermissionState"
import i18n, { changeLocale, i18nReady } from "@shared/i18n/runtime"
import { settleChat } from "../chatInteractionTestHarness"
import { NewSessionPermissionControl, PermissionModeControl } from "./PermissionModeControl"

vi.mock("@kobalte/core/dialog", async () => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (name: string) => string }
  }>("node:module")
  const entry = createRequire(import.meta.url).resolve("@kobalte/core/dialog")
  return vi.importActual(entry.replace(/\.jsx$/, ".js"))
})
vi.mock("@kobalte/core/select", async () => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (name: string) => string }
  }>("node:module")
  const entry = createRequire(import.meta.url).resolve("@kobalte/core/select")
  return vi.importActual(entry.replace(/\.jsx$/, ".js"))
})

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "aria-hidden" | "class">) =>
    <svg aria-hidden={props["aria-hidden"]} class={props.class} />
  const ShieldAlert = (props: Pick<JSX.IntrinsicElements["svg"], "aria-hidden" | "class">) =>
    <Icon aria-hidden={props["aria-hidden"]} class={`lucide-shield-alert ${props.class ?? ""}`} />
  return { Check: Icon, ChevronDown: Icon, ShieldAlert, X: Icon }
})

const read = vi.fn<typeof agentClient.getSessionPermissionMode>()
const patch = vi.fn<typeof agentClient.patchSessionPermissionMode>()
const disposers: (() => void)[] = []

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
const openOptions = () => settleChat(() => {
  selector().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
})

async function choose(mode: string) {
  if (selector().disabled) return
  await openOptions()
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((item) => item.textContent?.toLowerCase() === mode)
  if (!option) throw new Error(`Permission option ${mode} is missing`)
  await settleChat(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
}

function selectedMode() {
  const text = selector().textContent?.trim().toLowerCase() ?? ""
  return ["default", "bypass", "auto"].includes(text) ? text : ""
}

const click = (name: string) => settleChat(() => button(name).click())

async function mount(id = "a") {
  const container = document.body.appendChild(document.createElement("div"))
  const [sessionId, setSessionId] = createSignal(id)
  // The production composer also keys the control by Session identity.
  const dispose = render(() => <Show when={sessionId()} keyed>{(current) =>
    <PermissionModeControl sessionId={current} title={`Session ${current}`} />
  }</Show>, container)
  disposers.push(() => { dispose(); container.remove() })
  await settleChat()
  return { render: (next: string) => settleChat(() => setSessionId(next)) }
}

beforeEach(async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
  await i18nReady
  await changeLocale("en-US", { persist: false })
  appStore.getState().resetSessionPermissionModes()
  appStore.setState({ chats: [summary("a"), summary("b")].map(sessionSummaryToChatItem), currentSessionId: "a" })
  read.mockReset().mockImplementation(async (id) => snapshot("default", '"7"', id))
  patch.mockReset()
  vi.spyOn(agentClient, "getSessionPermissionMode").mockImplementation(read)
  vi.spyOn(agentClient, "patchSessionPermissionMode").mockImplementation(patch)
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  appStore.getState().resetSessionPermissionModes()
  vi.restoreAllMocks()
})

describe("Solid PermissionModeControl", () => {
  it("explains Supervisor inheritance in the ordinary Auto confirmation", async () => {
    const before = { ...snapshot(), supervisorDispatchInheritsPermissionMode: true as const }
    const auto = { ...snapshot("auto", '"8"'), supervisorDispatchInheritsPermissionMode: true as const }
    read.mockResolvedValueOnce(before).mockResolvedValueOnce(before)
    patch.mockResolvedValueOnce(auto)

    await mount()
    await choose("auto")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("New execution sessions started by this Supervisor inherit its permission mode.")
    expect(patch).not.toHaveBeenCalled()
    await click("Enable Auto")
    await settleChat()
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"7"', true)
    expect(selectedMode()).toBe("auto")
  })

  it("requires a fresh choice when an upgraded backend changes the confirmation scope", async () => {
    const upgraded = { ...snapshot(), supervisorDispatchInheritsPermissionMode: true as const }
    read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(upgraded)
    await mount()
    await choose("auto")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("New execution sessions")
    await click("Enable Auto")
    await settleChat()
    expect(patch).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("session changed")
    await choose("auto")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("New execution sessions")
  })

  it("discards an open Auto confirmation when an index refresh changes only its inheritance scope", async () => {
    const upgraded = { ...snapshot(), supervisorDispatchInheritsPermissionMode: true as const }
    read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(upgraded)
    await mount()
    await choose("auto")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("New execution sessions")
    await settleChat(async () => {
      appStore.getState().reconcileSessionPermissionModes([{
        ...summary("a"), supervisor_permission_etag: '"7"', supervisor_dispatch_inherits_permission_mode: true,
      }])
    })
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(patch).not.toHaveBeenCalled()
    await choose("auto")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("New execution sessions")
  })

  it("refreshes an upgraded Supervisor scope at the same permission mode and revision", async () => {
    const upgraded = { ...snapshot("auto"), supervisorDispatchInheritsPermissionMode: true as const }
    read.mockResolvedValueOnce(snapshot("auto")).mockResolvedValueOnce(upgraded)
    await mount()
    await settleChat(async () => {
      appStore.getState().reconcileSessionPermissionModes([{
        ...summary("a"), permission_mode: "auto", supervisor_permission_etag: '"7"',
        supervisor_dispatch_inherits_permission_mode: true,
      }])
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(selectedMode()).toBe("auto")
    expect(document.querySelector("section")?.textContent).toContain("New execution sessions")
    expect(patch).not.toHaveBeenCalled()
  })

  it("reads permissions when the selected session arrives after the composer mounts", async () => {
    appStore.setState({ chats: [] })
    await mount("a")
    expect(read).not.toHaveBeenCalled()
    expect(selector().textContent).not.toContain("Checking")
    await settleChat(async () => {
      appStore.setState({ chats: [sessionSummaryToChatItem(summary("a"))] })
    })
    await settleChat()
    expect(read).toHaveBeenCalledExactlyOnceWith("a")
    expect(selectedMode()).toBe("default")
    expect(selector().disabled).toBe(false)
  })

  it("uses the compact composer presentation without dropping its accessible help", async () => {
    await mount("a")
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
    await mount("a")
    await settleChat(() => selector().focus())
    await openOptions()
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!
    const surface = list.closest<HTMLElement>('[data-slot="select-content"]')
    expect(surface?.className).toContain("bg-popover")
    expect(surface?.className).toContain("text-popover-foreground")
    expect([...list.querySelectorAll('[role="option"]')].map((item) => item.textContent)).toEqual(["Default", "Bypass", "Auto"])
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toBe("Default")
    await settleChat(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await settleChat()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(selector()))
    expect(selectedMode()).toBe("default")
    expect(patch).not.toHaveBeenCalled()
  })

  it("uses the same themed choices for the next session without mutating existing sessions", async () => {
    const refresh = vi.fn(async () => {})
    const originalRefresh = newSessionPermissionStore.getState().refresh
    newSessionPermissionStore.setState({ mode: "bypass", refresh })
    const container = document.body.appendChild(document.createElement("div"))
    const dispose = render(() => <NewSessionPermissionControl />, container)
    disposers.push(() => { dispose(); container.remove() })
    try {
      await settleChat()
      expect(selectedMode()).toBe("bypass")
      expect(refresh).toHaveBeenCalledOnce()
      await choose("default")
      expect(newSessionPermissionStore.getState().mode).toBe("default")
      await choose("auto")
      expect(selectedMode()).toBe("auto")
      expect(newSessionPermissionStore.getState().mode).toBe("auto")
      expect(patch).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    } finally {
      newSessionPermissionStore.setState({ mode: "default", refresh: originalRefresh })
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
    await settleChat(async () => { pending.resolve(snapshot()); await pending.promise })
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
    await mount("a")
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Checking session permissions")
    await settleChat(async () => { pending.reject(new RequestTimeoutError()); await Promise.resolve(); await Promise.resolve() })
    const error = document.querySelector<HTMLElement>('[role="alert"]')!
    expect(error.textContent).toContain("timed out")
    expect(error.className).not.toContain("sr-only")
    expect(selector().disabled).toBe(true)
    read.mockResolvedValueOnce(snapshot())
    await click("Refresh mode"); await settleChat()
    expect(selectedMode()).toBe("default")
    expect(error.isConnected).toBe(false)
  })

  it("keeps unsupported errors visible in the compact composer", async () => {
    read.mockRejectedValueOnce(new SessionPermissionContractError())
    await mount("a")
    const error = document.querySelector<HTMLElement>('[role="alert"]')!
    expect(error.textContent).toContain("never interpreted as Auto")
    expect(error.className).not.toContain("sr-only")
    expect(button("Refresh mode")).toBeTruthy()
  })

  it("keeps the confirmed mode selected while saving and retains forced-confirmation Bypass copy", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise)
    await mount(); await choose("bypass")
    await settleChat()
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "bypass", '"7"', false)
    expect(selectedMode()).toBe("default"); expect(selector().disabled).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Saving mode…")
    await settleChat(async () => { pending.resolve(snapshot("bypass", '"8"')); await pending.promise })
    expect(selectedMode()).toBe("bypass"); expect(selector().disabled).toBe(false)
    expect(document.body.textContent).toContain("forced confirmations still ask")
  })

  it("requires a current-session Auto confirmation and puts initial focus on Cancel", async () => {
    await mount(); await choose("auto"); await settleChat()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("Enable Auto for this session?")
    expect(dialog?.textContent).toContain("Session a")
    expect(dialog?.textContent).toContain("Plan/Guardian")
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Cancel")))
    expect(patch).not.toHaveBeenCalled(); expect(selectedMode()).toBe("default")
    await click("Cancel"); await settleChat()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(selector())); expect(patch).not.toHaveBeenCalled()
  })

  it("sends Auto once only after explicit confirmation, without a Boolean write", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise)
    await mount(); await choose("auto"); await click("Enable Auto"); await choose("bypass")
    await settleChat()
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"7"', false)
    expect(selector().disabled).toBe(true)
    await settleChat(async () => { pending.resolve(snapshot("auto", '"8"')); await pending.promise })
    expect(selectedMode()).toBe("auto")
    expect(document.body.textContent).toContain("no approval prompts, including forced confirmations")
    expect(document.body.textContent).toContain("OS/sandbox limits still apply")
  })

  it("supports Escape cancellation and restores keyboard focus without sending", async () => {
    await mount(); await choose("auto"); await settleChat()
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Cancel")))
    await settleChat(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await settleChat()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(selector())); expect(patch).not.toHaveBeenCalled()
  })

  it("keeps the confirmed Auto intent when preflight only advances the metadata revision", async () => {
    await mount()
    read.mockResolvedValueOnce(snapshot("default", '"8"'))
    patch.mockResolvedValueOnce(snapshot("auto", '"9"'))
    await choose("auto"); await click("Enable Auto"); await settleChat()
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"8"', false)
    expect(read).toHaveBeenCalledTimes(2)
    expect(selectedMode()).toBe("auto"); expect(selector().disabled).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("shows a changed preflight mode and asks for re-selection without sending the confirmed Auto intent", async () => {
    await mount()
    read.mockResolvedValueOnce(snapshot("bypass", '"8"'))
    await choose("auto"); await click("Enable Auto"); await settleChat()
    expect(patch).not.toHaveBeenCalled()
    expect(selectedMode()).toBe("bypass"); expect(selector().disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("changed while you were choosing")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("shows the 412 winner with an error and no extra PATCH", async () => {
    await mount()
    patch.mockRejectedValueOnce(new ApiError("Conflict", 412, "Precondition Failed"))
    read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot("auto", '"9"'))
    await choose("bypass"); await settleChat()
    expect(selectedMode()).toBe("auto"); expect(selector().disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("session changed elsewhere")
    expect(patch).toHaveBeenCalledTimes(1)
  })

  it("clearly disables an ambiguous write plus failed read, and refresh only reads", async () => {
    await mount()
    patch.mockRejectedValueOnce(new NetworkRequestError())
    read.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new NetworkRequestError())
    await choose("auto"); await click("Enable Auto"); await settleChat()
    expect(selector().disabled).toBe(true); expect(selectedMode()).toBe("")
    expect(selector().textContent).toBe("Unconfirmed")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("current permission mode could not be confirmed")
    read.mockResolvedValueOnce(snapshot("auto", '"8"'))
    await click("Refresh mode"); await settleChat()
    expect(selector().disabled).toBe(false); expect(selectedMode()).toBe("auto")
    expect(patch).toHaveBeenCalledTimes(1)
  })

  it("does not display session A's late mutation in session B", async () => {
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise)
    const { render } = await mount(); await choose("auto"); await click("Enable Auto")
    await render("b")
    expect(selectedMode()).toBe("default"); expect(selector().disabled).toBe(false)
    await settleChat(async () => { pending.resolve(snapshot("auto", '"8"')); await pending.promise })
    expect(selectedMode()).toBe("default")
    expect(appStore.getState().chats.find((chat) => chat.id === "a")?.config.permissionMode).toBe("auto")
    expect(patch.mock.calls).toEqual([["a", "auto", '"7"', false]])
  })

  it("discards an unaccepted confirmation on session switches, including switching back", async () => {
    const { render } = await mount(); await choose("auto")
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await render("b"); await render("a")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(selectedMode()).toBe("default"); expect(patch).not.toHaveBeenCalled()
  })

  it("invalidates the Auto dialog if the authoritative ETag changes before confirmation", async () => {
    await mount(); await choose("auto")
    read.mockResolvedValueOnce(snapshot("bypass", '"8"'))
    await settleChat(async () => { await appStore.getState().refreshSessionPermissionMode("a") })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(selectedMode()).toBe("bypass"); expect(patch).not.toHaveBeenCalled()
  })

  it("localizes risk and error text while keeping all three explicit mode names", async () => {
    await changeLocale("zh-CN")
    await mount(); await choose("auto")
    expect(selector().getAttribute("aria-label")).toBe("权限模式")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("为当前会话启用 Auto？")
    expect(button("启用 Auto")).toBeTruthy(); expect(button("取消")).toBeTruthy()
  })
})
