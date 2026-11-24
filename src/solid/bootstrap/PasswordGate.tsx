import { createSignal, onSettled } from "solid-js"
import { Button } from "@/solid/ui/button"
import { Input } from "@/solid/ui/input"
import type { PasswordVerificationOutcome } from "@/services/bootstrap/serverBootstrap"
import type { BootstrapText } from "@/services/bootstrap/rootBootstrap"

interface Props {
  verifyPassword: (password: string, signal: AbortSignal) => Promise<PasswordVerificationOutcome>
  onVerified: () => void
  text: BootstrapText
}

const passwordUnavailable = "password_verification_is_temporarily_unavailable_please_2001e8cc"
const failureKey = {
  rejected: "incorrect_password_please_try_again_9380cc84",
  "rate-limited": "too_many_attempts_please_try_again_later_4cc53caf",
  unavailable: passwordUnavailable,
  "contract-error": "the_backend_password_api_is_incompatible_upgrade_the_ba_d923cbab",
} as const

export function PasswordGate(props: Props) {
  let input!: HTMLInputElement
  let activeController: AbortController | null = null
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<(typeof failureKey)[keyof typeof failureKey] | null>(null)
  const [loading, setLoading] = createSignal(false)

  onSettled(() => {
    input.focus()
    return () => {
      activeController?.abort()
      activeController = null
    }
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const submittedPassword = password()
    if (!submittedPassword || activeController) return

    const controller = new AbortController()
    activeController = controller
    setLoading(true)
    setError(null)
    const isCurrent = () => !controller.signal.aborted && activeController === controller

    try {
      const outcome = await props.verifyPassword(submittedPassword, controller.signal)
      if (!isCurrent()) return
      if (outcome.kind === "verified") props.onVerified()
      else setError(failureKey[outcome.kind])
    } catch {
      // Caller cancellation is lifecycle-only. Rejections never expose raw errors.
      if (isCurrent()) setError(passwordUnavailable)
    } finally {
      if (isCurrent()) {
        activeController = null
        setLoading(false)
      }
    }
  }

  return (
    <div class="flex h-full items-center justify-center bg-background p-6">
      <form
        class="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg"
        onSubmit={(event) => void submit(event)}
      >
        <h1 class="text-xl font-semibold">{props.text("enter_access_password_c0052de1")}</h1>
        <p class="mt-1 text-sm text-muted-foreground">{props.text("password_verification_is_required_before_entering_the_a_13035473")}</p>

        <label class="mt-5 block text-sm font-medium" for="access-password">
          {props.text("access_password_f4f712d5")}
        </label>
        <Input
          ref={(element) => { input = element }}
          id="access-password"
          type="password"
          value={password()}
          onInput={(event) => setPassword(event.currentTarget.value)}
          placeholder={props.text("please_enter_the_access_password_38433a0a")}
          autocomplete="current-password"
          // text-base (16px) on mobile avoids iOS focus auto-zoom.
          class="mt-1.5 h-auto rounded-lg py-2 !text-base"
        />
        {(() => {
          const key = error()
          return key && <p class="mt-2 text-sm text-destructive" role="alert">{props.text(key)}</p>
        })()}
        <Button
          type="submit"
          disabled={!password() || loading()}
          class="mt-4 w-full"
        >
          {loading() ? props.text("verifying_7f2d0739") : props.text("verify_and_continue_64ded447")}
        </Button>
      </form>
    </div>
  )
}
