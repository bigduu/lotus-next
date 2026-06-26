import { useEffect, useState } from "react"
import App from "./App"
import { PasswordGate } from "@/components/auth/PasswordGate"
import { Button } from "@/components/ui/button"
import { ServiceFactory } from "@services/common/ServiceFactory"

type Phase = "loading" | "setup" | "gate" | "ready"

/**
 * Boot gate: first-run setup → access password → app. Each check fails open so
 * local/dev (loopback, already set up) is never blocked.
 */
export default function Root() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [setupMsg, setSetupMsg] = useState("")

  const resolveAccess = async () => {
    try {
      const acc = await ServiceFactory.getInstance().getAccessStatus()
      setPhase(acc.requires_password ? "gate" : "ready")
    } catch {
      setPhase("ready")
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const setup = await ServiceFactory.getInstance().getSetupStatus()
        if (!setup.is_complete) {
          setSetupMsg(setup.message || "应用尚未完成首次设置。")
          setPhase("setup")
          return
        }
      } catch {
        /* fail open → access check */
      }
      await resolveAccess()
    })()
  }, [])

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中…
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
              await resolveAccess()
            }}
          >
            已完成,继续
          </Button>
        </div>
      </div>
    )
  }

  if (phase === "gate") {
    return <PasswordGate onVerified={() => setPhase("ready")} />
  }
  return <App />
}
