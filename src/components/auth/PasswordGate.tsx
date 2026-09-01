import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PasswordVerificationOutcome } from "@/services/bootstrap/serverBootstrap"

export interface PasswordGateProps {
  verifyPassword: (
    password: string,
    signal: AbortSignal,
  ) => Promise<PasswordVerificationOutcome>
  onVerified: () => void
}

const passwordFailureMessage = (
  outcome: Exclude<PasswordVerificationOutcome, { kind: "verified" }>,
): string => {
  switch (outcome.kind) {
    case "rejected":
      return "密码错误，请重新输入。"
    case "rate-limited":
      return "尝试次数过多，请稍后再试。"
    case "unavailable":
      return "密码验证服务暂时不可用，请稍后重试。"
    case "contract-error":
      return "后端密码验证接口不兼容，请升级后端后重试。"
  }
}

export function PasswordGate({ verifyPassword, onVerified }: PasswordGateProps) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const activeController = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      activeController.current?.abort()
      activeController.current = null
    },
    [],
  )

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password || loading) return

    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setLoading(true)
    setError(null)

    try {
      const outcome = await verifyPassword(password, controller.signal)
      if (controller.signal.aborted || activeController.current !== controller) return

      if (outcome.kind === "verified") {
        onVerified()
      } else {
        setError(passwordFailureMessage(outcome))
      }
    } catch {
      // Caller cancellation is lifecycle-only. An unexpected rejection from
      // the verifier still fails closed without exposing an arbitrary error.
      if (!controller.signal.aborted && activeController.current === controller) {
        setError("密码验证服务暂时不可用，请稍后重试。")
      }
    } finally {
      if (!controller.signal.aborted && activeController.current === controller) {
        activeController.current = null
        setLoading(false)
      }
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg"
        onSubmit={(event) => void submit(event)}
      >
        <h1 className="text-xl font-semibold">输入访问密码</h1>
        <p className="mt-1 text-sm text-muted-foreground">进入应用前需要先通过密码验证。</p>

        <label className="mt-5 block text-sm font-medium" htmlFor="access-password">
          访问密码
        </label>
        <Input
          id="access-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入访问密码"
          autoComplete="current-password"
          autoFocus
          // text-base (16px) on mobile avoids iOS focus auto-zoom.
          className="mt-1.5 h-auto rounded-lg py-2 !text-base"
        />
        {error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={!password || loading}
          className="mt-4 w-full"
        >
          {loading ? "验证中…" : "验证并继续"}
        </Button>
      </form>
    </div>
  )
}
