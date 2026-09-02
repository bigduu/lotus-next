const settingsChunkUrl = /(?:^|\/)Settings-[A-Za-z0-9_-]+\.js(?:[?#]|$)/

/**
 * Settings has a local Suspense/ErrorBoundary recovery surface. Let its import
 * rejection reach that boundary instead of applying the legacy whole-page
 * preload reload policy used by renderer/PDF chunks.
 */
export const isSettingsFeaturePreloadError = (payload: unknown): boolean => {
  const details =
    payload instanceof Error
      ? `${payload.message}\n${payload.stack ?? ""}`
      : typeof payload === "string"
        ? payload
        : ""
  return settingsChunkUrl.test(details)
}
