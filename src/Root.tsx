import { useCallback, useEffect, useRef, useState } from "react"
import App from "./App"
import { PasswordGate } from "@/components/auth/PasswordGate"
import { Button } from "@/components/ui/button"
import {
  requestServerBootstrap,
  verifyServerPassword,
  type BootstrapOutcome,
} from "@/services/bootstrap/serverBootstrap"
import { ServiceFactory } from "@services/common/ServiceFactory"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"

const RETRY_DELAYS_MS = [250, 500] as const

type NonReadyBootstrapOutcome = Exclude<BootstrapOutcome, { kind: "ready" }>
type DiagnosticOutcome = Exclude<NonReadyBootstrapOutcome, { kind: "auth-required" }>

type RootView =
  | { kind: "loading" }
  | { kind: "setup"; message: string }
  | { kind: "app" }
  | { kind: "internal-failure" }
  | NonReadyBootstrapOutcome

interface ActiveOperation {
  generation: number
  controller: AbortController
}

const waitForRetry = (ms: number, signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }

    const finish = (completed: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      resolve(completed)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(true), ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })

const diagnosticCopy = (
  outcome: DiagnosticOutcome | { kind: "internal-failure" },
): { title: string; description: string } => {
  switch (outcome.kind) {
    case "missing":
      return {
        title: "后端缺少启动契约",
        description:
          "当前后端没有提供 Lotus Next 所需的 canonical bootstrap。请升级 Bamboo 后端后重试。",
      }
    case "invalid":
      return {
        title: "后端启动响应无效",
        description:
          "后端返回了无法安全解析的启动信息。请检查部署是否完整，并升级为匹配的 Bamboo 版本。",
      }
    case "incompatible":
      return {
        title: "后端协议不兼容",
        description:
          "当前后端不满足 Lotus Next 所需的 HTTP v1 与 v2 stream 契约。请升级完整后端制品。",
      }
    case "auth-unsupported":
      return {
        title: "当前认证方式尚不受支持",
        description:
          "此部署仅接受设备凭据，而当前 Lotus Next 切片尚未接入设备配对与实时连接认证。",
      }
    case "repair":
      return {
        title: "后端访问配置需要修复",
        description:
          "Bamboo 已将访问控制置于安全隔离状态。请先在本机修复或重置访问配置，然后重试。",
      }
    case "unavailable":
    case "internal-failure":
      return {
        title: "暂时无法连接后端",
        description:
          "Bamboo 服务暂时不可用。请确认服务正在运行，并在网络或启动过程恢复后重试。",
      }
  }
}

/**
 * Shared boot composition for every Lotus Next surface.
 *
 * Bootstrap state is deliberately ephemeral and local to this root. A single
 * generation owns bootstrap retries plus the existing non-cancellable setup
 * request, so StrictMode, manual retry, password revalidation, and unmount can
 * never publish a stale result.
 */
export default function Root() {
  const runtime = getRuntimeConfig()
  const [view, setView] = useState<RootView>({ kind: "loading" })
  const generationRef = useRef(0)
  const activeOperationRef = useRef<ActiveOperation | null>(null)

  const beginOperation = useCallback((): ActiveOperation => {
    activeOperationRef.current?.controller.abort()
    const operation = {
      generation: generationRef.current + 1,
      controller: new AbortController(),
    }
    generationRef.current = operation.generation
    activeOperationRef.current = operation
    return operation
  }, [])

  const isCurrent = useCallback(
    (operation: ActiveOperation): boolean =>
      !operation.controller.signal.aborted &&
      activeOperationRef.current?.generation === operation.generation &&
      activeOperationRef.current.controller === operation.controller,
    [],
  )

  /** Post-bootstrap: preserve the existing setup card and fail-open behavior. */
  const resolveSetup = useCallback(
    async (operation: ActiveOperation) => {
      try {
        const setup = await ServiceFactory.getInstance().getSetupStatus()
        if (!isCurrent(operation)) return
        if (!setup.is_complete) {
          setView({
            kind: "setup",
            message: setup.message || "应用尚未完成首次设置。",
          })
          return
        }
      } catch {
        if (!isCurrent(operation)) return
        // Setup protocol migration is a separate slice. Preserve the current
        // local/dev fail-open behavior only after bootstrap admission.
      }

      if (isCurrent(operation)) setView({ kind: "app" })
    },
    [isCurrent],
  )

  const runBootstrap = useCallback(
    async (operation: ActiveOperation) => {
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt += 1) {
        let outcome: BootstrapOutcome
        try {
          outcome = await requestServerBootstrap(operation.controller.signal)
        } catch {
          if (!isCurrent(operation)) return
          // The service rejects only for caller cancellation. Any unexpected
          // rejection remains a safe, non-diagnostic failure and never mounts App.
          setView({ kind: "internal-failure" })
          return
        }

        if (!isCurrent(operation)) return

        if (outcome.kind === "unavailable" && attempt < RETRY_DELAYS_MS.length) {
          const completed = await waitForRetry(
            RETRY_DELAYS_MS[attempt],
            operation.controller.signal,
          )
          if (!completed || !isCurrent(operation)) return
          continue
        }

        if (outcome.kind === "ready") {
          await resolveSetup(operation)
          return
        }

        setView(outcome)
        return
      }
    },
    [isCurrent, resolveSetup],
  )

  const startBootstrap = useCallback(() => {
    const operation = beginOperation()
    setView({ kind: "loading" })
    void runBootstrap(operation)
  }, [beginOperation, runBootstrap])

  const completeSetup = useCallback(() => {
    const operation = beginOperation()
    setView({ kind: "loading" })
    void (async () => {
      await ServiceFactory.getInstance().markSetupComplete().catch(() => undefined)
      if (!isCurrent(operation)) return
      await resolveSetup(operation)
    })()
  }, [beginOperation, isCurrent, resolveSetup])

  useEffect(() => {
    startBootstrap()
    return () => {
      generationRef.current += 1
      activeOperationRef.current?.controller.abort()
      activeOperationRef.current = null
    }
  }, [startBootstrap])

  if (view.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }

  if (view.kind === "setup") {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
          <h1 className="text-xl font-semibold">首次设置</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{view.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            请在后端 / 桌面端配置提供方与密钥；完成后点击继续。
          </p>
          <Button className="mt-5 w-full" onClick={completeSetup}>
            已完成，继续
          </Button>
        </div>
      </div>
    )
  }

  if (view.kind === "auth-required") {
    return (
      <PasswordGate
        verifyPassword={verifyServerPassword}
        onVerified={startBootstrap}
      />
    )
  }

  if (view.kind === "app") return <App />

  const copy = diagnosticCopy(view)
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          {runtime.endpointSource} · v{runtime.artifact.version}
          {runtime.artifact.revision ? `@${runtime.artifact.revision}` : ""}
        </p>
        <Button className="mt-5 w-full" onClick={startBootstrap}>
          重试
        </Button>
      </div>
    </div>
  )
}
