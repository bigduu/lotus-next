export interface RecordedSessionNavigation {
  isCurrent: () => boolean
  restore: (id: string) => Promise<boolean>
  select: (id: string) => void
  notFound: () => Error
}
// The caller captures its navigation intent before entering this async flow.
// These ports restore existing Sessions; there is no creation/execution port.
export async function navigateRecordedSession(id: string, verifyAccess: () => Promise<boolean>, navigation: RecordedSessionNavigation): Promise<boolean> {
  if (!await verifyAccess() || !navigation.isCurrent()) return false
  const restored = await navigation.restore(id)
  if (!navigation.isCurrent()) return false
  if (!restored) throw navigation.notFound()
  navigation.select(id)
  return true
}
