import { uiText, useUiLocale } from "@shared/i18n/ui"
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
      return uiText("incorrect_password_please_try_again_9380cc84")
    case "rate-limited":
      return uiText("too_many_attempts_please_try_again_later_4cc53caf")
    case "unavailable":
      return uiText("password_verification_is_temporarily_unavailable_please_2001e8cc")
    case "contract-error":
      return uiText("the_backend_password_api_is_incompatible_upgrade_the_ba_d923cbab")
  }
}

export function PasswordGate({ verifyPassword, onVerified }: PasswordGateProps) {
  useUiLocale()
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
        setError(uiText("password_verification_is_temporarily_unavailable_please_2001e8cc"))
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
        <h1 className="text-xl font-semibold">{uiText("enter_access_password_c0052de1")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{uiText("password_verification_is_required_before_entering_the_a_13035473")}</p>

        <label className="mt-5 block text-sm font-medium" htmlFor="access-password">
          {uiText("access_password_f4f712d5")}</label>
        <Input
          id="access-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={uiText("please_enter_the_access_password_38433a0a")}
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
          {loading ? uiText("verifying_7f2d0739") : uiText("verify_and_continue_64ded447")}
        </Button>
      </form>
    </div>
  )
}
