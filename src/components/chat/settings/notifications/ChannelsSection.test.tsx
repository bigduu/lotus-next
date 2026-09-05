import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { ApiError, apiClient } from "@services/api"
import {
  NotificationConfigContractError,
  type NotificationConfigEnvelope,
  type NotificationCredentialState,
} from "@services/notification/notificationChannelsApi"
import { ChannelsSection } from "./ChannelsSection"

const notificationApi = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}))

vi.mock("@services/notification/notificationChannelsApi", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@services/notification/notificationChannelsApi")
  >()
  return {
    ...actual,
    getNotificationChannelsConfig: notificationApi.get,
    putNotificationChannelsConfig: notificationApi.put,
  }
})

const mountedRoots: Root[] = []
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const credential = (state: NotificationCredentialState) => ({
  credentialRef: state === "missing" ? null : `notification.test.${state}`,
  state,
  configured: state === "configured" || state === "from_env",
  ...(state === "configured" ? { source: "user" as const } : {}),
  ...(state === "from_env" ? { source: "environment" as const } : {}),
})

const snapshot = (
  revision = 7,
  options: {
    topic?: string
    ntfyCredential?: NotificationCredentialState
    barkCredential?: NotificationCredentialState
    fresh?: boolean
  } = {},
): NotificationConfigEnvelope => ({
  revision,
  status: options.fresh ? "missing" : "healthy",
  source: options.fresh ? "default" : "file",
  sourcePath: "/isolated/notifications.json",
  loadedAt: "2026-09-04T00:00:00.000Z",
  lastError: null,
  credentialRevision: options.fresh ? 0 : revision,
  credentialStatus: options.fresh ? "missing" : "healthy",
  credentialSource: options.fresh ? "default" : "file",
  credentialLastError: null,
  data: {
    desktop: { enabled: null },
    ntfy: {
      enabled: false,
      baseUrl: "https://ntfy.sh",
      topic: options.topic ?? "server-topic",
      credential: credential(options.ntfyCredential ?? "configured"),
    },
    bark: {
      enabled: false,
      baseUrl: "https://api.day.app",
      credential: credential(options.barkCredential ?? "configured"),
    },
  },
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const mount = async (element: React.ReactNode) => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return { container, root }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const button = (container: ParentNode, text: string): HTMLButtonElement | null =>
  [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text) ?? null

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const input = (container: ParentNode, label: string): HTMLInputElement => {
  const owner = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.querySelector("span")?.textContent === label,
  )
  const field = owner?.querySelector("input")
  expect(field).not.toBeNull()
  return field as HTMLInputElement
}

const changeInput = async (field: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  notificationApi.get.mockReset()
  notificationApi.put.mockReset()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("Notification Channels section authority", () => {
  it("accepts a fresh missing/default snapshot without inventing legacy defaults", async () => {
    notificationApi.get.mockResolvedValue(snapshot(0, {
      fresh: true,
      ntfyCredential: "missing",
      barkCredential: "missing",
    }))

    const { container } = await mount(<ChannelsSection />)

    expect(notificationApi.get).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("通知渠道")
    expect(input(container, "Topic").value).toBe("server-topic")
    expect(container.textContent).not.toContain("配置当前处于不安全")
  })

  it.each([
    [new ApiError("not found", 404, "Not Found", '{"error":{"message":"not found"}}'), "当前 Bamboo 不支持通知渠道分区配置"],
    [new NotificationConfigContractError(), "通知渠道配置格式与 Lotus Next 不兼容"],
  ])("renders unsupported or malformed loads as explicit failures", async (error, message) => {
    notificationApi.get.mockRejectedValue(error)

    const { container } = await mount(<ChannelsSection />)

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it("suppresses an out-of-order StrictMode GET instead of replacing newer authority", async () => {
    const first = deferred<NotificationConfigEnvelope>()
    const second = deferred<NotificationConfigEnvelope>()
    notificationApi.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { container } = await mount(
      <StrictMode>
        <ChannelsSection />
      </StrictMode>,
    )

    await act(async () => second.resolve(snapshot(2, { topic: "new-authority" })))
    await flush()
    expect(input(container, "Topic").value).toBe("new-authority")

    await act(async () => first.resolve(snapshot(1, { topic: "stale-authority" })))
    await flush()
    expect(input(container, "Topic").value).toBe("new-authority")
  })
})

describe("Notification Channels mutations", () => {
  it("installs and reports Bamboo's same-revision semantic no-op response", async () => {
    notificationApi.get.mockResolvedValue(snapshot(7))
    notificationApi.put.mockResolvedValue(snapshot(7))
    const { container } = await mount(<ChannelsSection />)

    await click(button(container, "保存渠道设置"))

    expect(notificationApi.put).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 7 }),
      expect.any(Object),
    )
    expect(container.querySelector('[role="status"]')?.textContent).toBe("已保存")
    expect(button(container, "保存渠道设置")?.disabled).toBe(false)
  })

  it("freezes every draft control while an accepted PUT is in flight", async () => {
    notificationApi.get.mockResolvedValue(snapshot(7))
    const pending = deferred<NotificationConfigEnvelope>()
    notificationApi.put.mockReturnValue(pending.promise)
    const { container } = await mount(<ChannelsSection />)

    const desktopMode = container.querySelector<HTMLButtonElement>(
      'button[aria-label="桌面通知模式"]',
    )
    expect(desktopMode).not.toBeNull()
    expect(desktopMode?.disabled).toBe(false)

    await click(button(container, "保存渠道设置"))

    expect(desktopMode?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="启用 ntfy"]')?.disabled).toBe(
      true,
    )
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="启用 Bark"]')?.disabled).toBe(
      true,
    )
    expect([...container.querySelectorAll<HTMLInputElement>("input")].every((field) => field.disabled)).toBe(
      true,
    )
    expect(button(container, "清除 ntfy Token")?.disabled).toBe(true)
    expect(button(container, "清除 Bark Device Key")?.disabled).toBe(true)
    expect(button(container, "保存中…")?.disabled).toBe(true)

    await act(async () => pending.resolve(snapshot(8)))
    await flush()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="桌面通知模式"]')?.disabled).toBe(
      false,
    )
    expect([...container.querySelectorAll<HTMLInputElement>("input")].every((field) => !field.disabled)).toBe(
      true,
    )
  })

  it("uses the exact installed revision and sends explicit keep, replace, and clear intents", async () => {
    notificationApi.get.mockResolvedValue(snapshot(7))
    notificationApi.put.mockImplementation(async (current: NotificationConfigEnvelope) =>
      snapshot(current.revision + 1),
    )
    const { container } = await mount(<ChannelsSection />)

    await click(button(container, "保存渠道设置"))
    expect(notificationApi.put).toHaveBeenNthCalledWith(1, expect.objectContaining({ revision: 7 }), {
      desktop: { enabled: null },
      ntfy: {
        enabled: false,
        base_url: "https://ntfy.sh",
        topic: "server-topic",
        credential_change: { action: "keep" },
      },
      bark: {
        enabled: false,
        base_url: "https://api.day.app",
        credential_change: { action: "keep" },
      },
    })

    const newToken = "new-ntfy-secret"
    await changeInput(input(container, "Token(可选,自托管实例)"), newToken)
    await click(button(container, "清除 Bark Device Key"))
    await click(button(container, "保存渠道设置"))

    expect(notificationApi.put).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ revision: 8 }),
      expect.objectContaining({
        ntfy: expect.objectContaining({
          credential_change: { action: "replace", value: newToken },
        }),
        bark: expect.objectContaining({
          credential_change: { action: "clear" },
        }),
      }),
    )
    expect(input(container, "Token(可选,自托管实例)").value).toBe("")
    expect(container.textContent).toContain("已保存")
  })

  it("requires an explicit replace or clear when credential metadata is in error", async () => {
    notificationApi.get.mockResolvedValue(snapshot(4, { ntfyCredential: "error" }))
    notificationApi.put.mockResolvedValue(snapshot(5, { ntfyCredential: "missing" }))
    const { container } = await mount(<ChannelsSection />)

    expect(container.textContent).toContain("凭据状态异常，保存前必须替换或清除")
    await click(button(container, "保存渠道设置"))
    expect(notificationApi.put).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("状态异常")

    await click(button(container, "清除 ntfy Token"))
    await click(button(container, "保存渠道设置"))
    expect(notificationApi.put).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4 }),
      expect.objectContaining({
        ntfy: expect.objectContaining({
          credential_change: { action: "clear" },
        }),
      }),
    )
  })

  it("rejects credential masks locally and redacts a submitted secret from errors", async () => {
    notificationApi.get.mockResolvedValue(snapshot(3))
    const { container } = await mount(<ChannelsSection />)
    const token = input(container, "Token(可选,自托管实例)")

    await changeInput(token, "****...****")
    await click(button(container, "保存渠道设置"))
    expect(notificationApi.put).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("不能使用凭据掩码")
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("****...****")

    const secret = "never-render-this-secret"
    await changeInput(token, secret)
    notificationApi.put.mockRejectedValue(new Error(`backend echoed ${secret} and ****...****`))
    await click(button(container, "保存渠道设置"))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("无法完成通知渠道配置请求")
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(secret)
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("****...****")
  })

  it("performs one PUT, fetches the conflict snapshot, preserves the draft, and retries only on explicit choice", async () => {
    notificationApi.get
      .mockResolvedValueOnce(snapshot(10, { topic: "loaded" }))
      .mockResolvedValueOnce(snapshot(11, { topic: "concurrent" }))
    notificationApi.put
      .mockRejectedValueOnce(
        new ApiError(
          "revision conflict",
          409,
          "Conflict",
          '{"error":{"message":"revision conflict","type":"api_error","code":"config_revision_conflict"}}',
        ),
      )
      .mockResolvedValueOnce(snapshot(12, { topic: "local-draft" }))
    const { container } = await mount(<ChannelsSection />)
    const topic = input(container, "Topic")
    await changeInput(topic, "local-draft")

    await click(button(container, "保存渠道设置"))
    await flush()

    expect(notificationApi.put).toHaveBeenCalledTimes(1)
    expect(notificationApi.put.mock.calls[0]?.[0]).toMatchObject({ revision: 10 })
    expect(notificationApi.get).toHaveBeenCalledTimes(2)
    expect(topic.value).toBe("local-draft")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已被其他客户端更新")
    expect(button(container, "载入服务器版本")).not.toBeNull()
    expect(button(container, "用当前修改重试")).not.toBeNull()
    expect(document.activeElement).toBe(button(container, "载入服务器版本"))

    await click(button(container, "用当前修改重试"))
    expect(notificationApi.put).toHaveBeenCalledTimes(2)
    expect(notificationApi.put.mock.calls[1]?.[0]).toMatchObject({ revision: 11 })
    expect(notificationApi.put.mock.calls[1]?.[1]).toMatchObject({
      ntfy: { topic: "local-draft" },
    })
    expect(input(container, "Topic").value).toBe("local-draft")
    expect(container.textContent).toContain("已保存")
  })

  it("does not silently replace an explicitly cleared Base URL with a default", async () => {
    notificationApi.get.mockResolvedValue(snapshot(7))
    const { container } = await mount(<ChannelsSection />)

    await changeInput(input(container, "ntfy Base URL"), "   ")
    await click(button(container, "保存渠道设置"))

    expect(notificationApi.put).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "ntfy Base URL 不能为空",
    )
  })

  it.each([" https://ntfy.example", "https://ntfy.example "])(
    "does not trim a non-canonical Base URL before mutation: %s",
    async (baseUrl) => {
      notificationApi.get.mockResolvedValue(snapshot(7))
      const { container } = await mount(<ChannelsSection />)

      await changeInput(input(container, "ntfy Base URL"), baseUrl)
      await click(button(container, "保存渠道设置"))

      expect(notificationApi.put).not.toHaveBeenCalled()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("不能包含首尾空格")
    },
  )

  it("lets the user explicitly discard the preserved draft for the fetched server version", async () => {
    notificationApi.get
      .mockResolvedValueOnce(snapshot(20, { topic: "loaded" }))
      .mockResolvedValueOnce(snapshot(21, { topic: "server-latest" }))
    notificationApi.put.mockRejectedValueOnce(
      new ApiError(
        "revision conflict",
        409,
        "Conflict",
        '{"error":{"message":"revision conflict","type":"api_error","code":"config_revision_conflict"}}',
      ),
    )
    const { container } = await mount(<ChannelsSection />)
    await changeInput(input(container, "Topic"), "local-draft")
    await click(button(container, "保存渠道设置"))
    await flush()

    await click(button(container, "载入服务器版本"))
    expect(input(container, "Topic").value).toBe("server-latest")
    expect(notificationApi.put).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain("已被其他客户端更新")
  })

  it("moves focus to the explicit refresh action when conflict recovery cannot load", async () => {
    notificationApi.get
      .mockResolvedValueOnce(snapshot(20, { topic: "loaded" }))
      .mockRejectedValueOnce(new Error("unavailable"))
    notificationApi.put.mockRejectedValueOnce(
      new ApiError(
        "revision conflict",
        409,
        "Conflict",
        '{"error":{"message":"revision conflict","type":"api_error","code":"config_revision_conflict"}}',
      ),
    )
    const { container } = await mount(<ChannelsSection />)

    await click(button(container, "保存渠道设置"))
    await flush()

    expect(document.activeElement).toBe(button(container, "重新获取最新版本"))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "通知渠道配置已被其他客户端更新",
    )
  })

  it("keeps the notification test endpoint and behavior unchanged", async () => {
    notificationApi.get.mockResolvedValue(snapshot())
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ attempted: ["ntfy"] })
    const { container } = await mount(<ChannelsSection />)

    await click(button(container, "测试通知渠道"))

    expect(post).toHaveBeenCalledWith("notifications/test")
    expect(container.textContent).toContain("已尝试:ntfy")
  })
})
