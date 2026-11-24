import { render, type JSX } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BootstrapOutcome, PasswordVerificationOutcome } from "@services/bootstrap/serverBootstrap"
import { ServiceFactory } from "@services/common/ServiceFactory"
import { SolidRoot, useOwnerAccess } from "./Root"

const bootstrapMocks = vi.hoisted(() => ({
  requestServerBootstrap: vi.fn(),
  verifyServerPassword: vi.fn(),
}))
const runtimeMocks = vi.hoisted(() => ({ sidecarBackend: false }))

// Vitest compiles application JSX. A browser build renders the package's SVG.
vi.mock("@lucide/solid", () => ({
  Loader2: (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />,
}))

vi.mock("@/services/bootstrap/serverBootstrap", () => ({
  requestServerBootstrap: bootstrapMocks.requestServerBootstrap,
  verifyServerPassword: bootstrapMocks.verifyServerPassword,
}))

vi.mock("@/runtime/runtimeConfig", () => ({
  getRuntimeConfig: () => ({
    schemaVersion: 1,
    host: {
      kind: runtimeMocks.sidecarBackend ? "bodhi-desktop" : "browser",
      capabilities: {
        nativeFileSystem: runtimeMocks.sidecarBackend,
        nativeNotifications: runtimeMocks.sidecarBackend,
        externalShell: runtimeMocks.sidecarBackend,
        sidecarBackend: runtimeMocks.sidecarBackend,
      },
    },
    endpointSource: runtimeMocks.sidecarBackend ? "tauri-sidecar" : "page-origin",
    endpoints: {
      origin: "http://127.0.0.1:9562",
      nativeApi: "http://127.0.0.1:9562/api/v1",
      v2Stream: "ws://127.0.0.1:9562/v2/stream",
    },
    publicMetadata: { mode: "test", development: false },
    artifact: { version: "0.0.0", revision: "test-revision" },
    auth: { source: "http-cookie", requestCredentials: "include" },
  }),
}))

interface MountedView {
  container: HTMLDivElement
  dispose: () => void
  mounted: boolean
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

const mountedViews: MountedView[] = []
const utilityService = ServiceFactory.getInstance()
let getSetupStatusMock = vi.fn()
let markSetupCompleteMock = vi.fn()

function AppProbe(props: { ownerAccess: boolean }) {
  return <div data-app-mounted="" data-owner-access={String(useOwnerAccess())}
    data-prop-owner-access={String(props.ownerAccess)}>Lotus Next App</div>
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  flush()
}

const advanceTimers = async (milliseconds: number) => {
  await vi.advanceTimersByTimeAsync(milliseconds)
  await flushMicrotasks()
}

const mountRoot = async (): Promise<MountedView> => {
  const container = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => <SolidRoot renderApp={(ownerAccess) => <AppProbe ownerAccess={ownerAccess} />} />, container)
  const view = { container, dispose, mounted: true }
  mountedViews.push(view)
  await flushMicrotasks()
  return view
}

const unmountView = (view: MountedView) => {
  if (!view.mounted) return
  view.dispose()
  view.mounted = false
  view.container.remove()
}

const clickButton = async (container: HTMLElement, label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  )
  expect(button, `Expected a button labeled ${label}`).toBeDefined()
  button!.click()
  await flushMicrotasks()
}

const enterPassword = (container: HTMLElement, password: string) => {
  const input = container.querySelector<HTMLInputElement>("#access-password")
  expect(input).not.toBeNull()
  input!.value = password
  input!.dispatchEvent(new Event("input", { bubbles: true }))
  flush()
}

beforeEach(() => {
  runtimeMocks.sidecarBackend = false
  bootstrapMocks.requestServerBootstrap.mockReset()
  bootstrapMocks.verifyServerPassword.mockReset()
  getSetupStatusMock = vi.fn().mockResolvedValue({
    is_complete: true,
    has_proxy_config: false,
    has_proxy_env: false,
    message: "",
  })
  markSetupCompleteMock = vi.fn().mockResolvedValue({ success: true })
  vi.spyOn(utilityService, "getSetupStatus").mockImplementation(getSetupStatusMock)
  vi.spyOn(utilityService, "markSetupComplete").mockImplementation(markSetupCompleteMock)
})

afterEach(() => {
  for (const view of mountedViews.splice(0)) unmountView(view)
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe("Root canonical bootstrap composition", () => {
  it("mounts App only after a ready bootstrap and the existing setup check", async () => {
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({ kind: "ready" })

    const { container } = await mountRoot()

    expect(getSetupStatusMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector("[data-app-mounted]")?.textContent).toBe("Lotus Next App")
  })

  it("opens the draft shell when the backend supports in-app model setup", async () => {
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({ kind: "ready" })
    getSetupStatusMock.mockResolvedValue({
      is_complete: false,
      model_setup_in_app: true,
      message: "legacy proxy status",
    })
    const { container } = await mountRoot()
    expect(container.querySelector("[data-app-mounted]")).not.toBeNull()
    expect(markSetupCompleteMock).not.toHaveBeenCalled()
  })

  it("keeps first-run setup behind bootstrap and guards its completion path", async () => {
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({ kind: "ready" })
    getSetupStatusMock
      .mockResolvedValueOnce({
        is_complete: false,
        has_proxy_config: false,
        has_proxy_env: false,
        message: "请配置提供方",
      })
      .mockResolvedValueOnce({
        is_complete: true,
        has_proxy_config: true,
        has_proxy_env: false,
        message: "",
      })

    const { container } = await mountRoot()
    expect(container.textContent).toContain("首次设置")
    expect(container.textContent).toContain("请配置提供方")
    expect(container.querySelector("[data-app-mounted]")).toBeNull()

    await clickButton(container, "已完成，继续")
    await flushMicrotasks()

    expect(markSetupCompleteMock).toHaveBeenCalledTimes(1)
    expect(getSetupStatusMock).toHaveBeenCalledTimes(2)
    expect(container.querySelector("[data-app-mounted]")).not.toBeNull()
  })

  it("ignores a late non-cancellable setup result after generation cleanup", async () => {
    const pendingSetup = deferred<{
      is_complete: boolean
      has_proxy_config: boolean
      has_proxy_env: boolean
      message: string
    }>()
    let bootstrapSignal: AbortSignal | undefined
    bootstrapMocks.requestServerBootstrap.mockImplementation((signal: AbortSignal) => {
      bootstrapSignal = signal
      return Promise.resolve({ kind: "ready" })
    })
    getSetupStatusMock.mockImplementationOnce(() => pendingSetup.promise)

    const view = await mountRoot()
    expect(getSetupStatusMock).toHaveBeenCalledTimes(1)
    expect(bootstrapSignal?.aborted).toBe(false)
    expect(view.container.textContent).toContain("正在连接 Bamboo")

    unmountView(view)
    expect(bootstrapSignal?.aborted).toBe(true)

    pendingSetup.resolve({
      is_complete: false,
      has_proxy_config: false,
      has_proxy_env: false,
      message: "过期结果不得显示",
    })
    await flushMicrotasks()

    expect(view.container.querySelector("[data-app-mounted]")).toBeNull()
    expect(view.container.textContent).not.toContain("过期结果不得显示")
  })

  it.each<[BootstrapOutcome, string]>([
    [{ kind: "missing" }, "后端缺少启动契约"],
    [{ kind: "invalid", reason: "document-shape" }, "后端启动响应无效"],
    [
      { kind: "incompatible", reason: "api-contract", status: 403 },
      "后端协议不兼容",
    ],
    [
      { kind: "auth-unsupported", mechanism: "device" },
      "当前认证方式尚不受支持",
    ],
    [{ kind: "repair" }, "后端访问配置需要修复"],
  ])("fails closed for %s with a distinct safe diagnostic", async (outcome, title) => {
    bootstrapMocks.requestServerBootstrap.mockResolvedValue(outcome)

    const { container } = await mountRoot()

    expect(container.textContent).toContain(title)
    expect(container.querySelector("[data-app-mounted]")).toBeNull()
    expect(getSetupStatusMock).not.toHaveBeenCalled()
  })

  it("owns exactly three unavailable attempts with abortable 250/500 ms delays", async () => {
    vi.useFakeTimers()
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({
      kind: "unavailable",
      reason: "network",
    })

    const { container } = await mountRoot()
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("正在连接 Bamboo")

    await advanceTimers(249)
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(1)

    await advanceTimers(1)
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(2)

    await advanceTimers(499)
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(2)

    await advanceTimers(1)
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain("暂时无法连接后端")
    expect(vi.getTimerCount()).toBe(0)
    expect(container.querySelector("[data-app-mounted]")).toBeNull()
  })

  it("keeps a slow sidecar in an animated loading state until it becomes ready", async () => {
    vi.useFakeTimers()
    runtimeMocks.sidecarBackend = true
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({
      kind: "unavailable",
      reason: "network",
    })

    const { container } = await mountRoot()
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在启动 Bodhi")
    expect(container.querySelector('[role="status"] svg.animate-spin')?.getAttribute("aria-hidden")).toBe("true")

    await advanceTimers(10_000)
    expect(bootstrapMocks.requestServerBootstrap.mock.calls.length).toBeGreaterThan(3)
    expect(container.textContent).toContain("正在等待本地 Bamboo 引擎")
    expect(container.textContent).not.toContain("暂时无法连接后端")

    bootstrapMocks.requestServerBootstrap.mockResolvedValue({ kind: "ready" })
    await advanceTimers(2_000)
    expect(container.querySelector("[data-app-mounted]")).not.toBeNull()
    expect(getSetupStatusMock).toHaveBeenCalledTimes(1)
  })

  it("turns a sidecar startup into a diagnostic only after the 60 second window", async () => {
    vi.useFakeTimers()
    runtimeMocks.sidecarBackend = true
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({
      kind: "unavailable",
      reason: "network",
    })

    const { container } = await mountRoot()
    await advanceTimers(59_999)
    expect(container.textContent).toContain("正在启动 Bodhi")
    expect(container.textContent).not.toContain("暂时无法连接后端")

    await advanceTimers(1)
    expect(container.textContent).toContain("暂时无法连接后端")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not retry a permanent result and manual retry starts one fresh request", async () => {
    vi.useFakeTimers()
    bootstrapMocks.requestServerBootstrap
      .mockResolvedValueOnce({ kind: "invalid", reason: "document-shape" })
      .mockResolvedValueOnce({ kind: "missing" })

    const { container } = await mountRoot()
    expect(container.textContent).toContain("后端启动响应无效")

    await advanceTimers(10_000)
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(1)

    await clickButton(container, "重试")
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("后端缺少启动契约")
  })

  it("aborts a disposed owner and ignores its late ready result after remount", async () => {
    const first = deferred<BootstrapOutcome>()
    const second = deferred<BootstrapOutcome>()
    const signals: AbortSignal[] = []
    bootstrapMocks.requestServerBootstrap
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal)
        return first.promise
      })
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal)
        return second.promise
      })

    const previous = await mountRoot()
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(1)
    expect(signals[0]?.aborted).toBe(false)
    unmountView(previous)

    const { container } = await mountRoot()
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)

    second.resolve({ kind: "invalid", reason: "document-shape" })
    await flushMicrotasks()
    expect(container.textContent).toContain("后端启动响应无效")

    first.resolve({ kind: "ready" })
    await flushMicrotasks()
    expect(container.textContent).toContain("后端启动响应无效")
    expect(container.querySelector("[data-app-mounted]")).toBeNull()
    expect(previous.container.querySelector("[data-app-mounted]")).toBeNull()
    expect(getSetupStatusMock).not.toHaveBeenCalled()
  })

  it("aborts the active bootstrap on unmount and ignores its result", async () => {
    const pending = deferred<BootstrapOutcome>()
    let signal: AbortSignal | undefined
    bootstrapMocks.requestServerBootstrap.mockImplementation((nextSignal: AbortSignal) => {
      signal = nextSignal
      return pending.promise
    })

    const view = await mountRoot()
    expect(signal?.aborted).toBe(false)
    unmountView(view)
    expect(signal?.aborted).toBe(true)

    pending.resolve({ kind: "ready" })
    await flushMicrotasks()
    expect(getSetupStatusMock).not.toHaveBeenCalled()
  })
})

describe("Root password revalidation", () => {
  it.each<[PasswordVerificationOutcome, string]>([
    [{ kind: "rejected" }, "密码错误，请重新输入。"],
    [{ kind: "rate-limited" }, "尝试次数过多，请稍后再试。"],
    [
      { kind: "unavailable", reason: "network" },
      "密码验证服务暂时不可用，请稍后重试。",
    ],
    [
      { kind: "contract-error", reason: "invalid-response" },
      "后端密码验证接口不兼容，请升级后端后重试。",
    ],
  ])("keeps the real PasswordGate closed for %s", async (outcome, message) => {
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({ kind: "auth-required" })
    bootstrapMocks.verifyServerPassword.mockResolvedValue(outcome)

    const { container } = await mountRoot()
    enterPassword(container, "secret")
    await clickButton(container, "验证并继续")

    expect(bootstrapMocks.verifyServerPassword).toHaveBeenCalledTimes(1)
    expect(bootstrapMocks.verifyServerPassword.mock.calls[0]?.[0]).toBe("secret")
    expect(bootstrapMocks.verifyServerPassword.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(container.textContent).toContain(message)
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(1)
    expect(container.querySelector("[data-app-mounted]")).toBeNull()
  })

  it("requires a fresh ready bootstrap after password verification before mounting App", async () => {
    const afterPassword = deferred<BootstrapOutcome>()
    bootstrapMocks.requestServerBootstrap
      .mockResolvedValueOnce({ kind: "auth-required" })
      .mockImplementationOnce(() => afterPassword.promise)
    bootstrapMocks.verifyServerPassword.mockResolvedValue({ kind: "verified" })

    const { container } = await mountRoot()
    enterPassword(container, "secret")
    await clickButton(container, "验证并继续")

    expect(bootstrapMocks.verifyServerPassword).toHaveBeenCalledTimes(1)
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("正在连接 Bamboo")
    expect(container.querySelector("[data-app-mounted]")).toBeNull()
    expect(getSetupStatusMock).not.toHaveBeenCalled()

    afterPassword.resolve({ kind: "ready" })
    await flushMicrotasks()
    expect(getSetupStatusMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector("[data-app-mounted]")).not.toBeNull()
  })

  it("aborts a pending PasswordGate verifier on unmount and ignores its late success", async () => {
    const pendingVerification = deferred<PasswordVerificationOutcome>()
    let verifierSignal: AbortSignal | undefined
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({ kind: "auth-required" })
    bootstrapMocks.verifyServerPassword.mockImplementation(
      (_password: string, signal: AbortSignal) => {
        verifierSignal = signal
        return pendingVerification.promise
      },
    )

    const view = await mountRoot()
    enterPassword(view.container, "secret")
    await clickButton(view.container, "验证并继续")
    expect(verifierSignal?.aborted).toBe(false)

    unmountView(view)
    expect(verifierSignal?.aborted).toBe(true)

    pendingVerification.resolve({ kind: "verified" })
    await flushMicrotasks()
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(1)
    expect(getSetupStatusMock).not.toHaveBeenCalled()
  })

  it("does not expose an arbitrary verifier rejection", async () => {
    bootstrapMocks.requestServerBootstrap.mockResolvedValue({ kind: "auth-required" })
    bootstrapMocks.verifyServerPassword.mockRejectedValue(
      new Error("SECRET verifier implementation detail"),
    )

    const { container } = await mountRoot()
    enterPassword(container, "secret")
    await clickButton(container, "验证并继续")

    expect(container.textContent).toContain("密码验证服务暂时不可用")
    expect(container.textContent).not.toContain("SECRET verifier implementation detail")
    expect(container.querySelector("[data-app-mounted]")).toBeNull()
  })
})

describe("Root ticket owner access", () => {
  it.each([
    ["local_bypass", "true"],
    ["authenticated", "true"],
    ["unauthenticated", "false"],
    [undefined, "false"],
  ])("publishes only the current admitted %s owner state", async (state, expected) => {
    bootstrapMocks.requestServerBootstrap.mockImplementation(async (_signal, admitted) => {
      if (state !== undefined) admitted(state)
      return { kind: "ready" }
    })
    const { container } = await mountRoot()
    const app = container.querySelector("[data-app-mounted]")
    expect(app?.getAttribute("data-owner-access")).toBe(expected)
    expect(app?.getAttribute("data-prop-owner-access")).toBe(expected)
  })

  it("ignores a late owner admission from the disposed owner after remount", async () => {
    const stale = deferred<BootstrapOutcome>()
    let admitStale!: (state: string) => void
    let staleSignal!: AbortSignal
    bootstrapMocks.requestServerBootstrap
      .mockImplementationOnce((signal: AbortSignal, admitted) => {
        staleSignal = signal
        admitStale = admitted
        return stale.promise
      })
      .mockImplementationOnce(async (_signal, admitted) => {
        admitted("unauthenticated")
        return { kind: "ready" }
      })
    const previous = await mountRoot()
    expect(staleSignal.aborted).toBe(false)
    unmountView(previous)
    expect(staleSignal.aborted).toBe(true)

    const { container } = await mountRoot()
    expect(container.querySelector("[data-app-mounted]")?.getAttribute("data-owner-access")).toBe("false")
    admitStale("local_bypass")
    stale.resolve({ kind: "ready" })
    await flushMicrotasks()
    expect(container.querySelector("[data-app-mounted]")?.getAttribute("data-owner-access")).toBe("false")
    expect(previous.container.querySelector("[data-app-mounted]")).toBeNull()
    expect(getSetupStatusMock).toHaveBeenCalledTimes(1)
  })

  it("requires current bootstrap admission after password verification", async () => {
    bootstrapMocks.requestServerBootstrap
      .mockResolvedValueOnce({ kind: "auth-required" })
      .mockImplementationOnce(async (_signal, admitted) => {
        admitted("unauthenticated")
        return { kind: "ready" }
      })
    bootstrapMocks.verifyServerPassword.mockResolvedValue({ kind: "verified" })
    const { container } = await mountRoot()
    enterPassword(container, "secret")
    await clickButton(container, "验证并继续")
    await flushMicrotasks()
    expect(bootstrapMocks.verifyServerPassword).toHaveBeenCalledTimes(1)
    expect(container.querySelector("[data-app-mounted]")?.getAttribute("data-owner-access")).toBe("false")
  })

  it("preserves admitted access through first-run setup without a second bootstrap request", async () => {
    bootstrapMocks.requestServerBootstrap.mockImplementation(async (_signal, admitted) => {
      admitted("local_bypass")
      return { kind: "ready" }
    })
    getSetupStatusMock.mockResolvedValueOnce({ is_complete: false, message: "setup" })
      .mockResolvedValueOnce({ is_complete: true, message: "" })
    const { container } = await mountRoot()
    await clickButton(container, "已完成，继续")
    await flushMicrotasks()
    expect(container.querySelector("[data-app-mounted]")?.getAttribute("data-owner-access")).toBe("true")
    expect(bootstrapMocks.requestServerBootstrap).toHaveBeenCalledTimes(1)
  })
})
