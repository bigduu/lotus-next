/** Compare RFC 3339 instants without discarding nanoseconds. Invalid dates produce NaN. */
export function compareRfc3339Instants(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right)
  if (milliseconds !== 0) return milliseconds
  const fraction = (value: string) => /\.(\d{1,9})(?:Z|[+-])/.exec(value)?.[1].padEnd(9, "0") ?? "000000000"
  return fraction(left).localeCompare(fraction(right))
}
