import {
  formatCompact,
  formatDateTime,
  formatExact,
  formatPercent,
} from "@/components/chat/settings/metrics/format"
import { createUiLocale } from "../../shell/uiText"

export function createMetricFormatters() {
  const locale = createUiLocale()
  return {
    compact: (value: Parameters<typeof formatCompact>[0]) => {
      locale()
      return formatCompact(value)
    },
    exact: (value: Parameters<typeof formatExact>[0]) => {
      locale()
      return formatExact(value)
    },
    percent: (value: Parameters<typeof formatPercent>[0]) => {
      locale()
      return formatPercent(value)
    },
    dateTime: (value: Parameters<typeof formatDateTime>[0]) => {
      locale()
      return formatDateTime(value)
    },
  }
}

export function shortEndpoint(endpoint: string): string {
  return endpoint.split(".").pop() || endpoint
}
