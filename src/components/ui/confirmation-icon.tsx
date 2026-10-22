import { Check, Copy, type LucideIcon } from "lucide-react"

export function ConfirmationIcon({
  confirmed,
  sequence,
  fallback: Fallback = Copy,
  className,
}: {
  confirmed: boolean
  sequence: number
  fallback?: LucideIcon
  className?: string
}) {
  return confirmed ? (
    <Check
      key={sequence}
      aria-hidden="true"
      className={`confirmation-icon ${className ?? ""}`}
      data-copy-confirmation="true"
    />
  ) : <Fallback aria-hidden="true" className={className} />
}
