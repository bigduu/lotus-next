import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  AccountStreamHandlers,
  AgentEvent,
  AgentEventHandlers,
  ChangeEvent,
} from "./AgentService"

vi.mock("@/runtime/runtimeConfig", () => ({
  getRuntimeConfig: () => ({
    endpoints: { v2Stream: "ws://127.0.0.1:9562/v2/stream" },
  }),
}))

let msgpackEnabled = false
vi.mock("@shared/utils/debugFlags", () => ({
  debugLog: () => {},
  isApiV2MsgpackEnabled: () => msgpackEnabled,
}))

import {
  __resetV2StreamForTests,
  isSocketOpen,
  onReconnected,
  subscribeAgent,
  subscribeFeed,
  type AgentEventDispatch,
} from "./v2Stream"

const sockets: MockWebSocket[] = []

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readonly offeredProtocols: string[]
  readyState = MockWebSocket.CONNECTING
  protocol = ""
  binaryType = "blob"
  sent: unknown[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.offeredProtocols =
      protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols]
    sockets.push(this)
  }

  send(data: unknown): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
  }

  open(negotiatedProtocol = ""): void {
    this.protocol = negotiatedProtocol
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent)
  }

  emitBinary(frame: unknown): void {
    const data = Uint8Array.from(msgpackEncode(frame)).buffer
    this.onmessage?.({ data } as MessageEvent)
  }

  emitRaw(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  drop(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  parsedSent(): Array<Record<string, unknown>> {
    return this.sent.map((frame) => {
      if (typeof frame !== "string") throw new TypeError("expected a JSON text frame")
      return JSON.parse(frame) as Record<string, unknown>
    })
  }

  msgpackSent(): Array<Record<string, unknown>> {
    return this.sent.map((frame) => {
      if (frame instanceof ArrayBuffer) {
        return msgpackDecode(new Uint8Array(frame)) as Record<string, unknown>
      }
      if (ArrayBuffer.isView(frame)) {
        return msgpackDecode(
          new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
        ) as Record<string, unknown>
      }
      throw new TypeError("expected a MessagePack binary frame")
    })
  }
}

const lastSocket = (): MockWebSocket => sockets.at(-1)!

const change = (seq: number): ChangeEvent => ({
  seq,
  ts: "2026-09-01T00:00:00Z",
  session_id: "session-1",
  event: { type: "token", content: `change-${seq}` },
})

const tokenDispatch: AgentEventDispatch = (event: AgentEvent, handlers: AgentEventHandlers) => {
  if (event.type === "token") handlers.onToken?.(event.content ?? "")
}

describe("v2Stream shared WebSocket client", () => {
  beforeEach(() => {
    sockets.length = 0
    msgpackEnabled = false
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    __resetV2StreamForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("opens the canonical v2 URL lazily and reports socket readiness", () => {
    expect(isSocketOpen()).toBe(false)

    const feed = subscribeFeed({ onChange: vi.fn() }, 0)

    expect(sockets).toHaveLength(1)
    expect(lastSocket().url).toBe("ws://127.0.0.1:9562/v2/stream")
    expect(lastSocket().offeredProtocols).toEqual([])
    expect(isSocketOpen()).toBe(false)

    lastSocket().open()
    expect(isSocketOpen()).toBe(true)

    feed.close()
    expect(isSocketOpen()).toBe(false)
  })

  it("sends hello and the feed resume cursor when the socket opens", () => {
    subscribeFeed({ onChange: vi.fn() }, 5)

    lastSocket().open()

    expect(lastSocket().parsedSent()).toEqual([
      { type: "hello" },
      { type: "subscribe", ch: "feed", since: 5 },
    ])
  })

  it("routes full feed events and resumes from the latest durable cursor", () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    subscribeFeed({ onChange }, 2)
    const first = lastSocket()
    first.open()

    const event = change(11)
    first.emit({ ch: "feed", seq: 1, event })
    expect(onChange).toHaveBeenCalledWith(event)

    first.drop()
    vi.advanceTimersByTime(500)
    const second = lastSocket()
    expect(second).not.toBe(first)

    second.open()
    expect(second.parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 11 })
  })

  it("resets the feed cursor and calls onReset after feed_reset", () => {
    vi.useFakeTimers()
    const onReset = vi.fn()
    subscribeFeed({ onChange: vi.fn(), onReset }, 42)
    const first = lastSocket()
    first.open()

    first.emit({ ch: "feed", seq: 0, control: { type: "feed_reset", from_seq: 42 } })
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onReset).toHaveBeenCalledWith()

    first.drop()
    vi.advanceTimersByTime(500)
    lastSocket().open()
    expect(lastSocket().parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 0 })
  })

  it("reports feed open, transport error, and close signals", () => {
    const onOpen = vi.fn()
    const onError = vi.fn()
    subscribeFeed({ onChange: vi.fn(), onOpen, onError }, 0)
    const socket = lastSocket()

    socket.open()
    expect(onOpen).toHaveBeenCalledTimes(1)

    socket.onerror?.()
    expect(onError).toHaveBeenCalledTimes(1)

    socket.drop()
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it("dispatches an agent event and resolves on terminal", async () => {
    const onToken = vi.fn()
    const subscription = subscribeAgent("session-1", { onToken }, tokenDispatch)
    const socket = lastSocket()
    socket.open()

    expect(socket.parsedSent()).toContainEqual({
      type: "subscribe",
      ch: "agent.session-1",
    })

    socket.emit({
      ch: "agent.session-1",
      seq: 1,
      event: { type: "token", content: "hello" },
    })
    expect(onToken).toHaveBeenCalledWith("hello")

    socket.emit({ ch: "agent.session-1", seq: 2, control: { type: "terminal" } })
    await expect(subscription.promise).resolves.toBeUndefined()
    expect(socket.parsedSent()).toContainEqual({
      type: "unsubscribe",
      ch: "agent.session-1",
    })
  })

  it("multiplexes feed and agent subscriptions over one socket", () => {
    const feed = subscribeFeed({ onChange: vi.fn() }, 0)
    const agent = subscribeAgent("session-1", {}, tokenDispatch)

    expect(sockets).toHaveLength(1)
    const socket = lastSocket()
    socket.open()

    expect(socket.parsedSent()).toEqual([
      { type: "hello" },
      { type: "subscribe", ch: "feed", since: 0 },
      { type: "subscribe", ch: "agent.session-1" },
    ])

    const close = vi.spyOn(socket, "close")
    feed.close()
    expect(close).not.toHaveBeenCalled()

    agent.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("uses one wire channel for multiple local subscribers to the same session", async () => {
    const firstToken = vi.fn()
    const secondToken = vi.fn()
    const first = subscribeAgent("session-1", { onToken: firstToken }, tokenDispatch)
    const second = subscribeAgent("session-1", { onToken: secondToken }, tokenDispatch)
    const socket = lastSocket()
    socket.open()

    const subscribeFrames = socket
      .parsedSent()
      .filter((frame) => frame.type === "subscribe" && frame.ch === "agent.session-1")
    expect(subscribeFrames).toHaveLength(1)

    socket.emit({
      ch: "agent.session-1",
      seq: 1,
      event: { type: "token", content: "shared" },
    })
    expect(firstToken).toHaveBeenCalledWith("shared")
    expect(secondToken).toHaveBeenCalledWith("shared")

    first.close()
    expect(socket.parsedSent()).not.toContainEqual({
      type: "unsubscribe",
      ch: "agent.session-1",
    })

    socket.emit({ ch: "agent.session-1", seq: 2, control: { type: "terminal" } })
    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual([undefined, undefined])

    const unsubscribeFrames = socket
      .parsedSent()
      .filter((frame) => frame.type === "unsubscribe" && frame.ch === "agent.session-1")
    expect(unsubscribeFrames).toHaveLength(1)
  })

  it("stops feed delivery and sends one unsubscribe after close", () => {
    const onChange = vi.fn()
    const feed = subscribeFeed({ onChange }, 0)
    const socket = lastSocket()
    socket.open()

    feed.close()
    expect(socket.parsedSent()).toContainEqual({ type: "unsubscribe", ch: "feed" })

    socket.emit({ ch: "feed", seq: 1, event: change(1) })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("re-subscribes every live channel and notifies reconnect listeners", () => {
    vi.useFakeTimers()
    const reconnected = vi.fn()
    const removeListener = onReconnected(reconnected)
    subscribeFeed({ onChange: vi.fn() }, 7)
    subscribeAgent("session-1", {}, tokenDispatch)
    const first = lastSocket()
    first.open()
    expect(reconnected).not.toHaveBeenCalled()

    first.drop()
    vi.advanceTimersByTime(500)
    const second = lastSocket()
    second.open()

    expect(second.parsedSent()).toEqual([
      { type: "hello" },
      { type: "subscribe", ch: "feed", since: 7 },
      { type: "subscribe", ch: "agent.session-1" },
    ])
    expect(reconnected).toHaveBeenCalledTimes(1)

    removeListener()
    second.drop()
    vi.advanceTimersByTime(500)
    lastSocket().open()
    expect(reconnected).toHaveBeenCalledTimes(1)
  })

  it("keeps retrying an initial WSS failure instead of falling back to SSE", () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    subscribeFeed({ onChange: vi.fn(), onError }, 0)
    const failed = lastSocket()

    failed.drop()
    expect(onError).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)
    const retry = lastSocket()
    retry.open()
    expect(retry.parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 0 })
  })

  it("ignores malformed, incomplete, and unknown frames", () => {
    const onChange = vi.fn()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    subscribeFeed({ onChange }, 0)
    const socket = lastSocket()
    socket.open()

    expect(() => socket.emitRaw("{not json")).not.toThrow()
    expect(() => socket.emit({ seq: 1, event: {} })).not.toThrow()
    expect(() => socket.emit({ ch: "unknown", seq: 1, event: {} })).not.toThrow()
    expect(() => socket.emit({ ch: "feed", seq: 2 })).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("accepts the public AccountStreamHandlers contract", () => {
    const handlers: AccountStreamHandlers = { onChange: vi.fn() }
    expect(handlers.onChange).toBeTypeOf("function")
  })

  describe("MessagePack negotiation", () => {
    it("uses JSON text frames by default", () => {
      const onChange = vi.fn()
      subscribeFeed({ onChange }, 5)
      const socket = lastSocket()
      socket.open()

      expect(socket.offeredProtocols).toEqual([])
      expect(socket.sent.every((frame) => typeof frame === "string")).toBe(true)

      const event = change(6)
      socket.emit({ ch: "feed", seq: 6, event })
      expect(onChange).toHaveBeenCalledWith(event)
    })

    it("offers the Bamboo subprotocol and requests ArrayBuffer frames when enabled", () => {
      msgpackEnabled = true
      subscribeFeed({ onChange: vi.fn() }, 0)

      expect(lastSocket().offeredProtocols).toEqual(["bamboo.v2.msgpack"])
      expect(lastSocket().binaryType).toBe("arraybuffer")
    })

    it("encodes and decodes MessagePack after successful negotiation", () => {
      msgpackEnabled = true
      const onChange = vi.fn()
      subscribeFeed({ onChange }, 5)
      const socket = lastSocket()
      socket.open("bamboo.v2.msgpack")

      expect(socket.msgpackSent()).toEqual([
        { type: "hello" },
        { type: "subscribe", ch: "feed", since: 5 },
      ])

      const event = change(9)
      socket.emitBinary({ ch: "feed", seq: 9, event })
      expect(onChange).toHaveBeenCalledWith(event)
    })

    it("stays on JSON when the server does not echo the offered protocol", () => {
      msgpackEnabled = true
      subscribeFeed({ onChange: vi.fn() }, 3)
      const socket = lastSocket()
      socket.open("")

      expect(socket.offeredProtocols).toEqual(["bamboo.v2.msgpack"])
      expect(socket.sent.every((frame) => typeof frame === "string")).toBe(true)
      expect(socket.parsedSent()).toContainEqual({ type: "subscribe", ch: "feed", since: 3 })
    })

    it("ignores malformed binary input without delivering an event", () => {
      msgpackEnabled = true
      const onChange = vi.fn()
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      subscribeFeed({ onChange }, 0)
      const socket = lastSocket()
      socket.open("bamboo.v2.msgpack")

      expect(() => socket.emitRaw(new Uint8Array([0xc1, 0xff, 0xff]).buffer)).not.toThrow()
      expect(onChange).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
    })
  })
})
