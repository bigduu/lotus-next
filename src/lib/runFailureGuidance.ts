import { uiText } from "@shared/i18n/ui"
export type RunFailureGuidance = {
  title: string
  action: string
}

/** Explain known provider failures without hiding the original diagnostic. */
export function describeRunFailure(detail: string | null): RunFailureGuidance | null {
  if (!detail) return null

  if (/\blast_http_status=429\b|\bHTTP\s+429\b/i.test(detail)) {
    return {
      title: uiText("model_service_rate_limited_8b54cf50"),
      action: uiText("the_provider_or_proxy_returned_429_wait_for_the_rate_li_b76133d9"),
    }
  }

  if (/\bStream timed out:\s*phase=bootstrap\b/i.test(detail)) {
    return {
      title: uiText("model_service_connection_timed_out_ecde837c"),
      action: uiText("the_model_response_could_not_be_established_check_the_p_c6ee27c5"),
    }
  }

  return null
}
