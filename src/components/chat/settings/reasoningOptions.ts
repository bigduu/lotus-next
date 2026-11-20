import type { ReasoningEffort } from "@services/chat/AgentService"
import { uiText } from "@shared/i18n/ui"

export const REASONING_OPTIONS: readonly { value: ReasoningEffort; label: string }[] = [
  { value: "none", get label() { return uiText("reasoning_none") } },
  { value: "low", get label() { return uiText("low_aa9e366f") } },
  { value: "medium", get label() { return uiText("medium_a567bdaa") } },
  { value: "high", get label() { return uiText("high_b1c27820") } },
  { value: "xhigh", get label() { return uiText("extra_high_392d0dce") } },
  { value: "max", get label() { return uiText("max_9730c15f") } },
]
