import { apiClient, isApiError } from "../api"
import { settingsService } from "./SettingsService"
import { parseProviderInstancesConfig, PROVIDER_DEFAULT_MODEL_REF_KEYS } from "@shared/types/providerConfig"
import {
  MAX_SHARE_PASSPHRASE_BYTES, MAX_SHARE_STRING_BYTES, MIN_SHARE_PASSPHRASE_BYTES,
  type ShareApplyRequest, type ShareInput, type ShareInventory, type ShareOperation,
  type SharePreviewResponse, type ShareSelection, type ShareRevisions,
} from "@shared/types/configShare"

export class ConfigShareError extends Error {
  constructor(readonly kind: "invalid" | "stale" | "unavailable" | "unconfirmed") {
    // Never retain backend errors: they can contain submitted sensitive data.
    super(`Configuration sharing ${kind}`)
    this.name = "ConfigShareError"
  }
}
const route = "/bamboo/config/share"
const options = (signal?: AbortSignal): RequestInit => ({
  cache: "no-store", headers: { "Cache-Control": "no-store" }, signal,
})
const utf8Size = (value: string): number => new TextEncoder().encode(value).length
const validatePassphrase = (passphrase?: string) => {
  if (passphrase === undefined) return
  const size = utf8Size(passphrase)
  if (!passphrase.trim() || size < MIN_SHARE_PASSPHRASE_BYTES || size > MAX_SHARE_PASSPHRASE_BYTES) throw new ConfigShareError("invalid")
}
const validateInput = (input: ShareInput) => {
  if (!input.share_string.trim().startsWith("BAMBOO-SHARE:1:") || utf8Size(input.share_string) > MAX_SHARE_STRING_BYTES) {
    throw new ConfigShareError("invalid")
  }
  validatePassphrase(input.passphrase)
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const boundedString = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1_024
const safeRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const validRevisions = (value: unknown): value is ShareRevisions => isRecord(value) &&
  safeRevision(value.providers) && safeRevision(value.env) && safeRevision(value.credentials)
const validOrigin = (value: unknown): value is string => {
  if (!boundedString(value)) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash && value === parsed.origin
  } catch { return false }
}

/** Validate metadata without ever decoding or rendering the original bundle. */
const validatePreview = (value: unknown): SharePreviewResponse => {
  if (!isRecord(value) || !boundedString(value.preview_token) || !validRevisions(value.expected_revisions) || !isRecord(value.preview) || typeof value.apply_blocked !== "boolean" ||
    (value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.length > 16 || value.warnings.some((warning) => !boundedString(warning))))) {
    throw new ConfigShareError("unavailable")
  }
  const p = value.preview
  const rows = [p.providers, p.scenarios, p.subagent_models, p.env]
  if (rows.some((row) => !Array.isArray(row) || row.length > 256) || typeof p.contains_secrets !== "boolean") throw new ConfigShareError("unavailable")
  for (const row of rows.flat() as unknown[]) {
    if (!isRecord(row) || typeof row.conflict !== "boolean") throw new ConfigShareError("unavailable")
  }
  for (const row of p.providers as Record<string, unknown>[]) {
    if (!boundedString(row.id) || !boundedString(row.provider_type) || (row.label !== undefined && !boundedString(row.label)) ||
      typeof row.has_api_key !== "boolean" || typeof row.has_base_url !== "boolean" ||
      typeof row.replace_allowed !== "boolean" || (!row.conflict && !row.replace_allowed) ||
      typeof row.retains_existing_api_key !== "boolean" || typeof row.credential_origin_risk !== "boolean" ||
      (row.source_origin !== undefined && !validOrigin(row.source_origin)) ||
      (row.target_origin !== undefined && !validOrigin(row.target_origin)) ||
      row.has_base_url !== (row.source_origin !== undefined) ||
      (row.retains_existing_api_key && !row.conflict) ||
      row.credential_origin_risk !== (row.conflict && row.has_base_url && row.source_origin !== row.target_origin)) {
      throw new ConfigShareError("unavailable")
    }
  }
  for (const row of [...p.scenarios as Record<string, unknown>[], ...p.subagent_models as Record<string, unknown>[]]) {
    if (!boundedString(row.provider) || !boundedString(row.model)) throw new ConfigShareError("unavailable")
  }
  for (const row of p.scenarios as Record<string, unknown>[]) {
    if (!PROVIDER_DEFAULT_MODEL_REF_KEYS.includes(row.scenario as never)) throw new ConfigShareError("unavailable")
  }
  for (const row of [...p.subagent_models as Record<string, unknown>[], ...p.env as Record<string, unknown>[]]) {
    if (!boundedString(row.name)) throw new ConfigShareError("unavailable")
  }
  for (const row of p.env as Record<string, unknown>[]) {
    if (typeof row.has_value !== "boolean" || typeof row.secret !== "boolean") throw new ConfigShareError("unavailable")
  }
  // Copy only the redacted contract; never retain an accidental secret field
  // or raw backend diagnostics in component state.
  const typed = value as unknown as SharePreviewResponse
  return {
    preview_token: typed.preview_token,
    apply_blocked: typed.apply_blocked,
    warnings: (typed.warnings ?? []).filter((warning) => ["automatic_provider_authentication_blocked", "credential_key_uninitialized"].includes(warning)),
    expected_revisions: { providers: typed.expected_revisions.providers, env: typed.expected_revisions.env, credentials: typed.expected_revisions.credentials },
    preview: {
      contains_secrets: typed.preview.contains_secrets,
      providers: typed.preview.providers.map(({ id, provider_type, label, has_api_key, has_base_url, conflict, replace_allowed, source_origin, target_origin, retains_existing_api_key, credential_origin_risk }) => ({
        id, provider_type, ...(label ? { label } : {}), has_api_key, has_base_url, conflict, replace_allowed,
        ...(source_origin ? { source_origin } : {}), ...(target_origin ? { target_origin } : {}),
        retains_existing_api_key, credential_origin_risk,
      })),
      scenarios: typed.preview.scenarios.map(({ scenario, provider, model, conflict }) => ({ scenario, provider, model, conflict })),
      subagent_models: typed.preview.subagent_models.map(({ name, provider, model, conflict }) => ({ name, provider, model, conflict })),
      env: typed.preview.env.map(({ name, has_value, secret, conflict }) => ({ name, has_value, secret, conflict })),
    },
  }
}
const validateOperationId = (value: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new ConfigShareError("invalid")
}
const validateOperation = (value: unknown, operationId: string): ShareOperation => {
  if (!isRecord(value) || value.operation_id !== operationId ||
    !["committed", "pending", "rejected", "not_found"].includes(value.state as string) ||
    (value.revisions !== undefined && !validRevisions(value.revisions))) throw new ConfigShareError("unconfirmed")
  const revisions = value.revisions as ShareOperation["revisions"]
  return { operation_id: operationId, state: value.state as ShareOperation["state"], ...(revisions ? { revisions: { providers: revisions.providers, env: revisions.env, credentials: revisions.credentials } } : {}) }
}
const safeFailure = (error: unknown, fallback: "unavailable" | "unconfirmed"): ConfigShareError => {
  if (error instanceof ConfigShareError) return error
  if (isApiError(error) && error.status === 409) return new ConfigShareError("stale")
  // share_busy (429) is guaranteed by Bamboo before this attempt enters
  // derivation or commit. The UI never replays an uncertain operation id.
  if (isApiError(error) && [400, 401, 403, 413, 422, 429].includes(error.status)) return new ConfigShareError("invalid")
  return new ConfigShareError(fallback)
}

export class ConfigShareService {
  /** Wait only for the server-owned saved configuration; never query a provider catalog. */
  async waitForProviderRefresh(revisions?: ShareRevisions): Promise<void> {
    if (!validRevisions(revisions)) throw new ConfigShareError("unavailable")
    const signal = AbortSignal.timeout(3_000)
    try {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const value = await apiClient.get<unknown>("/bamboo/config/live-health", options(signal))
        if (isRecord(value) && isRecord(value.providers) && value.providers.status === "healthy" &&
          safeRevision(value.providers.revision) && value.providers.revision >= revisions.providers &&
          isRecord(value.application) && isRecord(value.application.sections) && Array.isArray(value.application.consumers)) {
          const sections = value.application.sections
          const observed = Object.entries(revisions).every(([section, revision]) =>
            isRecord(sections[section]) && safeRevision(sections[section].revision) && (sections[section].revision as number) >= revision,
          )
          const provider = value.application.consumers.find((consumer) => isRecord(consumer) && consumer.id === "provider-runtime")
          if (observed && isRecord(provider) && provider.state === "in_sync" && isRecord(provider.applied_dependencies) &&
            safeRevision(provider.applied_dependencies.providers) && provider.applied_dependencies.providers >= revisions.providers &&
            isRecord(provider.credential_source) && (
              (provider.applied_dependencies.credentials === undefined && provider.credential_source.status === "not_required") || (
                safeRevision(provider.applied_dependencies.credentials) && provider.applied_dependencies.credentials >= revisions.credentials &&
                provider.credential_source.status === "observed_inputs" &&
                safeRevision(provider.credential_source.revision) && provider.credential_source.revision >= revisions.credentials
              )
            )) return
        }
        if (attempt < 14 && !signal.aborted) await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve() }
          const timer = setTimeout(finish, 200)
          signal.addEventListener("abort", finish, { once: true })
          if (signal.aborted) finish()
        })
        if (signal.aborted) break
      }
    } catch { throw new ConfigShareError("unavailable") }
    throw new ConfigShareError("unavailable")
  }

  async inventory(): Promise<ShareInventory> {
    try {
      const [rawProviders, env] = await Promise.all([settingsService.getProviderInstances(), settingsService.getEnvVars()])
      const snapshot = parseProviderInstancesConfig(rawProviders)
      // Match Bamboo's configured_provider_routing_key: exact id, selected
      // default of that type, then the lexical first enabled instance.
      const routingId = (provider: string): string => {
        const normalized = provider.trim()
        if (snapshot.instances.some((candidate) => candidate.id === normalized)) return normalized
        const selected = snapshot.instances.find((candidate) => candidate.id === snapshot.default_provider_instance_id)
        if (selected?.type === normalized) return selected.id
        return snapshot.instances.filter((candidate) => candidate.enabled && candidate.type === normalized)
          .map((candidate) => candidate.id).sort()[0] ?? normalized
      }
      // Store only display metadata. Existing GETs never supply API keys.
      return {
        providers: snapshot.instances.map(({ id, label, type }) => ({ id, label, type })),
        scenarios: PROVIDER_DEFAULT_MODEL_REF_KEYS.flatMap((name) => {
          const ref = snapshot.defaults?.[name]
          return ref ? [{ name, provider: routingId(ref.provider), model: ref.model }] : []
        }),
        subagent_models: Object.entries(snapshot.defaults?.subagent_models ?? {}).map(([name, ref]) => ({ name, provider: routingId(ref.provider), model: ref.model })),
        env: env.entries.map(({ name, secret, has_value }) => ({ name, secret, has_value })),
      }
    } catch { throw new ConfigShareError("unavailable") }
  }

  async export(selection: ShareSelection, includeSecrets: boolean, passphrase?: string, signal?: AbortSignal): Promise<string> {
    validatePassphrase(passphrase)
    const hasSecrets = selection.provider_api_keys.length > 0 || Object.values(selection.env).some(Boolean)
    if (hasSecrets && (!includeSecrets || !passphrase)) throw new ConfigShareError("invalid")
    try {
      const result = await apiClient.postOnce<{ share_string: string }>(`${route}/export`, {
        selection, include_secrets: includeSecrets, ...(passphrase ? { passphrase } : {}),
      }, options(signal))
      if (!result || typeof result.share_string !== "string") throw new ConfigShareError("unavailable")
      validateInput({ share_string: result.share_string })
      return result.share_string
    } catch (error) { throw safeFailure(error, "unavailable") }
  }

  async preview(input: ShareInput, signal?: AbortSignal): Promise<SharePreviewResponse> {
    validateInput(input)
    try {
      return validatePreview(await apiClient.postOnce<unknown>(`${route}/preview`, input, options(signal)))
    } catch (error) { throw safeFailure(error, "unavailable") }
  }

  async apply(request: ShareApplyRequest): Promise<ShareOperation> {
    validateInput(request)
    validateOperationId(request.operation_id)
    try {
      return validateOperation(await apiClient.postOnce<unknown>(`${route}/apply`, request, options()), request.operation_id)
    } catch (error) { throw safeFailure(error, "unconfirmed") }
  }

  async operation(operationId: string): Promise<ShareOperation> {
    validateOperationId(operationId)
    try {
      return validateOperation(await apiClient.get<unknown>(`${route}/operations/${operationId}`, options()), operationId)
    } catch (error) { throw safeFailure(error, "unconfirmed") }
  }
}
export const configShareService = new ConfigShareService()
