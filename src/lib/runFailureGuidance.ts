import { uiText } from "@shared/i18n/text"
export type RunFailureGuidance = {
  title: string
  action: string
}

/** Explain known run failures without hiding the original diagnostic. */
export function describeRunFailure(detail: string | null): RunFailureGuidance | null {
  if (!detail) return null

  if (/\b(?:The model returned no summary|Context compression could not finish\. Your conversation history was preserved)\./i.test(detail)) {
    return {
      title: uiText("context_compression_run_interrupted"),
      action: uiText("context_compression_run_history_preserved"),
    }
  }

  if (/Native canonical Session Source scope changed/i.test(detail)) {
    return {
      title: uiText("session_source_changed"),
      action: uiText("session_source_changed_action"),
    }
  }

  const failure = detail.replace(/^Turn \d+ failed terminally: /i, "")
  const status = failure.match(/^(?:LLM (?:error|overflow): )?(?:API error: )?(?:(?:Anthropic|Gemini) API error: )?HTTP (400|401|403)\b/i)?.[1]
  if (status === "401" || status === "403" || /^(?:LLM error: )?Authentication error:/i.test(failure)) {
    return {
      title: uiText("run_failure_model_access_rejected"),
      action: uiText("run_failure_model_access_rejected_action"),
    }
  }

  if (status === "400") {
    return {
      title: uiText("run_failure_model_request_rejected"),
      action: uiText("run_failure_model_request_rejected_action"),
    }
  }

  if (/^Empty assistant response from LLM\b/i.test(failure)) {
    return {
      title: uiText("run_failure_model_empty_response"),
      action: uiText("run_failure_model_empty_response_action"),
    }
  }

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

  if (/^Stream timed out:\s*phase=(?:first_semantic|transport_idle|semantic_idle)\b/i.test(failure)) {
    return {
      title: uiText("run_failure_model_response_timed_out"),
      action: uiText("run_failure_model_response_timed_out_action"),
    }
  }

  return null
}
