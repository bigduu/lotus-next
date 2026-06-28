import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ServiceFactory } from "@services/common/ServiceFactory"

export function PasswordGate({ onVerified }: { onVerified: () => void }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!password || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await ServiceFactory.getInstance().verifyAccessPassword(password)
      if (res.success) onVerified()
      else setError("密码错误")
    } catch {
      setError("验证失败,请重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg">
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
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
          }}
          placeholder="请输入访问密码"
          autoFocus
          // text-base (16px) on mobile avoids iOS focus auto-zoom.
          className="mt-1.5 h-auto rounded-lg py-2 !text-base"
        />
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

        <Button
          onClick={() => void submit()}
          disabled={!password || loading}
          className="mt-4 w-full"
        >
          {loading ? "验证中…" : "验证并继续"}
        </Button>
      </div>
    </div>
  )
}
