export type RunFailureGuidance = {
  title: string
  action: string
}

/** Explain known provider failures without hiding the original diagnostic. */
export function describeRunFailure(detail: string | null): RunFailureGuidance | null {
  if (!detail) return null

  if (/\blast_http_status=429\b|\bHTTP\s+429\b/i.test(detail)) {
    return {
      title: "模型服务正在限流",
      action: "提供商或代理返回了 429。请等待限流解除，或切换可用模型后重试。",
    }
  }

  if (/\bStream timed out:\s*phase=bootstrap\b/i.test(detail)) {
    return {
      title: "模型服务连接超时",
      action: "模型响应未能建立。请检查提供商、代理和网络状态，然后重试。",
    }
  }

  return null
}
