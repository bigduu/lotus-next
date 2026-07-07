import { useEffect, useState } from "react"
import App from "./App"
import { PasswordGate } from "@/components/auth/PasswordGate"
import { Button } from "@/components/ui/button"
import { ServiceFactory } from "@services/common/ServiceFactory"

type Phase = "loading" | "unreachable" | "setup" | "gate" | "ready"

/** How many times to probe the backend before declaring it unreachable. */
const CONNECT_ATTEMPTS = 10
/** Delay between backend probes (total wait ≈ CONNECT_ATTEMPTS × this). */
const CONNECT_RETRY_MS = 2_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Boot gate: backend reachable → access password → first-run setup → app.
 *
 * Order matters: `access/status` is a PUBLIC route, but `setup/status` is
 * password-gated on remote deploys — probing setup before the gate would 401
 * and silently skip the first-run card. So the gate always comes first, and
 * the setup probe runs after verification (or immediately when no password is
 * required). The setup probe itself fails open so local/dev is never blocked.
 */
export default function Root() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [setupMsg, setSetupMsg] = useState("")

  /** Post-gate: decide setup card vs app. Fails open to the app. */
  const resolveSetup = async () => {
    try {
      const setup = await ServiceFactory.getInstance().getSetupStatus()
      if (!setup.is_complete) {
        setSetupMsg(setup.message || "应用尚未完成首次设置。")
        setPhase("setup")
        return
      }
    } catch {
      /* fail open → app */
    }
    setPhase("ready")
  }

  const boot = async () => {
    setPhase("loading")
    // Wait (bounded) for the backend: it may still be starting up. The access
    // probe is public, so a success both proves reachability and tells us
    // whether a password gate is required.
    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
      try {
        const acc = await ServiceFactory.getInstance().getAccessStatus()
        if (acc.requires_password) {
          setPhase("gate")
          return
        }
        await resolveSetup()
        return
      } catch {
        await sleep(CONNECT_RETRY_MS)
      }
    }
    setPhase("unreachable")
  }

  useEffect(() => {
    void boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount
  }, [])

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }

  if (phase === "unreachable") {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
          <h1 className="text-xl font-semibold">无法连接后端</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            后端服务没有响应。请确认它正在运行,然后重试。
          </p>
          <Button className="mt-5 w-full" onClick={() => void boot()}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (phase === "setup") {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
          <h1 className="text-xl font-semibold">首次设置</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{setupMsg}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            请在后端 / 桌面端配置提供方与密钥;完成后点击继续。
          </p>
          <Button
            className="mt-5 w-full"
            onClick={async () => {
              await ServiceFactory.getInstance().markSetupComplete().catch(() => {})
              setPhase("loading")
              await resolveSetup()
            }}
          >
            已完成,继续
          </Button>
        </div>
      </div>
    )
  }

  if (phase === "gate") {
    return (
      <PasswordGate
        onVerified={() => {
          // Now authenticated: the setup probe can finally succeed on gated
          // deploys — run it instead of jumping straight into the app.
          setPhase("loading")
          void resolveSetup()
        }}
      />
    )
  }
  return <App />
}
