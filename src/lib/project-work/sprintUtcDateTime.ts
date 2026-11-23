export function parseSprintUtcDateTime(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.0{1,3})?)?$/.exec(value)
  if (!match) return undefined
  const [year, month, day, hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)]
  if (year < 1) return undefined
  // Set/get UTC fields explicitly, including years 1–99; never let local DST or
  // Date's calendar normalization choose a different instant from the input.
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return undefined
  const seconds = date.getTime() / 1000
  return Number.isSafeInteger(seconds) ? seconds : undefined
}
export function formatSprintUtcDateTime(seconds: number | null): string | undefined {
  if (seconds === null) return ""
  if (!Number.isSafeInteger(seconds)) return undefined
  const date = new Date(seconds * 1000)
  const year = date.getUTCFullYear()
  if (year < 1 || year > 9999 || date.getTime() / 1000 !== seconds) return undefined
  const pad = (part: number) => part.toString().padStart(2, "0")
  const value = `${year.toString().padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  return parseSprintUtcDateTime(value) === seconds ? value : undefined
}
