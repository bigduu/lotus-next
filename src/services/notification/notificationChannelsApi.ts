import { apiClient, getErrorMessage, isApiError, isRequestError } from "../api/index.ts"
import { isMaskedSecret } from "@/lib/secrets.ts"

const NOTIFICATION_CONFIG_PATH = "bamboo/config/notifications"

const SECTION_STATUSES = ["healthy", "missing", "degraded", "invalid"] as const
const SECTION_SOURCES = ["file", "backup", "default"] as const
const CREDENTIAL_STATES = ["configured", "from_env", "missing", "error"] as const
const CREDENTIAL_SOURCES = ["user", "migrated", "environment", "external_store"] as const

export type NotificationSectionStatus = (typeof SECTION_STATUSES)[number]
export type NotificationSectionSource = (typeof SECTION_SOURCES)[number]
export type NotificationCredentialState = (typeof CREDENTIAL_STATES)[number]
export type NotificationCredentialSource = (typeof CREDENTIAL_SOURCES)[number]

export interface NotificationCredentialStatus {
  credentialRef: string | null
  state: NotificationCredentialState
  configured: boolean
  source?: NotificationCredentialSource
  updatedAt?: string
}

export interface NotificationChannelData {
  desktop: {
    enabled: boolean | null
  }
  ntfy: {
    enabled: boolean
    baseUrl: string
    topic: string
    credential: NotificationCredentialStatus
  }
  bark: {
    enabled: boolean
    baseUrl: string
    credential: NotificationCredentialStatus
  }
}

/**
 * The normalized, secret-free subset that the notification editor may retain.
 * The raw duplicated section envelope is validated but deliberately discarded.
 */
export interface NotificationConfigEnvelope {
  revision: number
  status: NotificationSectionStatus
  source: NotificationSectionSource
  sourcePath: string
  loadedAt: string
  lastError: string | null
  credentialRevision: number
  credentialStatus: NotificationSectionStatus
  credentialSource: NotificationSectionSource
  credentialLastError: string | null
  data: NotificationChannelData
}

export type CredentialChange =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "clear" }

export interface NotificationMutationData {
  desktop: {
    enabled: boolean | null
  }
  ntfy: {
    enabled: boolean
    base_url: string
    topic: string
    credential_change: CredentialChange
  }
  bark: {
    enabled: boolean
    base_url: string
    credential_change: CredentialChange
  }
}

export type NotificationConfigErrorCode =
  | "config_revision_conflict"
  | "config_recovery_pending"

export class NotificationConfigContractError extends Error {
  constructor(message = "Notification configuration response is incompatible") {
    super(message)
    this.name = "NotificationConfigContractError"
  }
}

export class NotificationConfigAuthorityError extends Error {
  constructor(authority: "section" | "credential", status: NotificationSectionStatus) {
    super(`Notification ${authority} authority is ${status}`)
    this.name = "NotificationConfigAuthorityError"
  }
}

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const incompatible = (message: string): never => {
  throw new NotificationConfigContractError(message)
}

const record = (value: unknown, label: string): JsonRecord => {
  if (!isRecord(value)) incompatible(`${label} must be an object`)
  return value as JsonRecord
}

const exactKeys = (value: JsonRecord, allowed: readonly string[], label: string): void => {
  const allowedSet = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    incompatible(`${label} contains unsupported fields`)
  }
}

const nonnegativeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    incompatible(`${label} must be a non-negative integer`)
  }
  return value as number
}

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== "string") incompatible(`${label} must be a string`)
  return value as string
}

const nonemptyString = (value: unknown, label: string): string => {
  const parsed = stringValue(value, label)
  if (parsed.trim().length === 0) incompatible(`${label} must not be empty`)
  return parsed
}

const secretFreeHttpUrl = (value: unknown, label: string): string => {
  const parsed = stringValue(value, label)
  if (parsed.trim().length === 0 || parsed.trim() !== parsed) {
    incompatible(`${label} must be nonempty and canonical`)
  }
  const url = (() => {
    try {
      return new URL(parsed)
    } catch {
      return incompatible(`${label} must be an absolute HTTP(S) URL`)
    }
  })()
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    incompatible(`${label} must be an absolute HTTP(S) URL`)
  }
  if (url.username || url.password || parsed.includes("?") || parsed.includes("#")) {
    incompatible(`${label} must not contain userinfo, query parameters, or a fragment`)
  }
  return parsed
}

const nullableString = (value: unknown, label: string): string | null => {
  if (value !== null && typeof value !== "string") {
    incompatible(`${label} must be a string or null`)
  }
  return value as string | null
}

const timestamp = (value: unknown, label: string): string => {
  const parsed = stringValue(value, label)
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      parsed,
    )
  const year = Number(match?.[1])
  const month = Number(match?.[2])
  const day = Number(match?.[3])
  const hour = Number(match?.[4])
  const minute = Number(match?.[5])
  const second = Number(match?.[6])
  const offsetHour = Number(match?.[7] ?? 0)
  const offsetMinute = Number(match?.[8] ?? 0)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    !match ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    Number.isNaN(Date.parse(parsed))
  ) {
    incompatible(`${label} must be an RFC 3339 timestamp`)
  }
  return parsed
}

const enumValue = <T extends readonly string[]>(
  value: unknown,
  choices: T,
  label: string,
): T[number] => {
  if (typeof value !== "string" || !choices.includes(value as T[number])) {
    incompatible(`${label} is unsupported`)
  }
  return value as T[number]
}

const FORBIDDEN_SECRET_KEYS = new Set([
  "apikey",
  "ciphertext",
  "devicekey",
  "devicekeyencrypted",
  "password",
  "plaintext",
  "privatekey",
  "refreshtoken",
  "secret",
  "token",
  "tokenencrypted",
])

const normalizedSecretKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "")

const assertSecretFree = (value: unknown): void => {
  if (typeof value === "string") {
    if (isMaskedSecret(value)) incompatible("Notification response contains a credential mask")
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertSecretFree)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(normalizedSecretKey(key))) {
      incompatible("Notification response contains secret-shaped material")
    }
    assertSecretFree(child)
  }
}

const assertReadableAuthority = (
  authority: "section" | "credential",
  status: NotificationSectionStatus,
  source: NotificationSectionSource,
  revision: number,
  lastError: string | null,
): void => {
  if (status === "degraded" || status === "invalid") {
    throw new NotificationConfigAuthorityError(authority, status)
  }
  if (status === "missing") {
    if (source !== "default" || revision !== 0 || lastError !== null) {
      incompatible(`Notification ${authority} missing authority metadata is invalid`)
    }
    return
  }
  if (source !== "file" || lastError !== null) {
    incompatible(`Notification ${authority} healthy authority source is invalid`)
  }
}

const parseCredential = (value: unknown, label: string): NotificationCredentialStatus => {
  const raw = record(value, label)
  exactKeys(raw, ["credential_ref", "state", "configured", "source", "updated_at"], label)
  const credentialRef = nullableString(raw.credential_ref, `${label}.credential_ref`)
  if (credentialRef !== null && credentialRef.trim().length === 0) {
    incompatible(`${label}.credential_ref must not be empty`)
  }
  const state = enumValue(raw.state, CREDENTIAL_STATES, `${label}.state`)
  if (typeof raw.configured !== "boolean") incompatible(`${label}.configured must be a boolean`)
  const configured = raw.configured as boolean
  const source =
    raw.source === undefined
      ? undefined
      : enumValue(raw.source, CREDENTIAL_SOURCES, `${label}.source`)
  const updatedAt =
    raw.updated_at === undefined ? undefined : timestamp(raw.updated_at, `${label}.updated_at`)

  const configuredState = state === "configured" || state === "from_env"
  if (configured !== configuredState) incompatible(`${label} configured metadata is inconsistent`)
  if (configuredState && (!credentialRef || !source)) {
    incompatible(`${label} configured metadata is incomplete`)
  }
  if (state === "missing" && credentialRef !== null) {
    incompatible(`${label} missing metadata cannot retain a credential reference`)
  }
  if (state === "error" && credentialRef === null) {
    incompatible(`${label} error metadata requires a credential reference`)
  }
  if (
    (state === "from_env" && source !== "environment") ||
    (state === "configured" && source === "environment")
  ) {
    incompatible(`${label} source metadata is inconsistent`)
  }
  if (
    (state === "missing" || state === "error") &&
    (source !== undefined || updatedAt !== undefined)
  ) {
    incompatible(`${label} unavailable metadata is inconsistent`)
  }

  return { credentialRef, state, configured, source, updatedAt }
}

const parseData = (value: unknown): NotificationChannelData => {
  const raw = record(value, "Notification data")
  exactKeys(raw, ["desktop", "ntfy", "bark"], "Notification data")

  const desktop = record(raw.desktop, "Notification data.desktop")
  exactKeys(desktop, ["enabled"], "Notification data.desktop")
  if (desktop.enabled !== null && typeof desktop.enabled !== "boolean") {
    incompatible("Notification data.desktop.enabled must be a boolean or null")
  }

  const ntfy = record(raw.ntfy, "Notification data.ntfy")
  exactKeys(ntfy, ["enabled", "base_url", "topic", "credential"], "Notification data.ntfy")
  if (typeof ntfy.enabled !== "boolean") {
    incompatible("Notification data.ntfy.enabled must be a boolean")
  }

  const bark = record(raw.bark, "Notification data.bark")
  exactKeys(bark, ["enabled", "base_url", "credential"], "Notification data.bark")
  if (typeof bark.enabled !== "boolean") {
    incompatible("Notification data.bark.enabled must be a boolean")
  }

  return {
    desktop: { enabled: desktop.enabled as boolean | null },
    ntfy: {
      enabled: ntfy.enabled as boolean,
      baseUrl: secretFreeHttpUrl(ntfy.base_url, "Notification data.ntfy.base_url"),
      topic: stringValue(ntfy.topic, "Notification data.ntfy.topic"),
      credential: parseCredential(ntfy.credential, "Notification data.ntfy.credential"),
    },
    bark: {
      enabled: bark.enabled as boolean,
      baseUrl: secretFreeHttpUrl(bark.base_url, "Notification data.bark.base_url"),
      credential: parseCredential(bark.credential, "Notification data.bark.credential"),
    },
  }
}

const sectionCredentialRef = (value: unknown, label: string): string | null => {
  if (value === undefined) return null
  return nonemptyString(value, label)
}

const assertSectionChannelMatches = (
  value: unknown,
  expected: {
    enabled: boolean
    baseUrl: string
    topic?: string
    credential: NotificationCredentialStatus
  },
  label: string,
): void => {
  const raw = record(value, label)
  exactKeys(
    raw,
    expected.topic === undefined
      ? ["enabled", "base_url", "credential_ref", "configured"]
      : ["enabled", "base_url", "topic", "credential_ref", "configured"],
    label,
  )
  if (raw.enabled !== expected.enabled || raw.base_url !== expected.baseUrl) {
    incompatible(`${label} public settings are inconsistent with the typed response`)
  }
  if (expected.topic !== undefined && raw.topic !== expected.topic) {
    incompatible(`${label}.topic is inconsistent with the typed response`)
  }
  if (typeof raw.configured !== "boolean") incompatible(`${label}.configured must be a boolean`)
  if (
    sectionCredentialRef(raw.credential_ref, `${label}.credential_ref`) !==
    expected.credential.credentialRef
  ) {
    incompatible(`${label}.credential_ref is inconsistent with the typed response`)
  }
  if (raw.configured !== (expected.credential.state !== "missing")) {
    incompatible(`${label}.configured is inconsistent with the typed response`)
  }
}

const assertSectionDataMatches = (value: unknown, expected: NotificationChannelData): void => {
  const section = record(value, "Notification response.section.data")
  exactKeys(section, ["notifications"], "Notification response.section.data")
  const notifications = record(
    section.notifications,
    "Notification response.section.data.notifications",
  )
  exactKeys(
    notifications,
    ["desktop", "ntfy", "bark"],
    "Notification response.section.data.notifications",
  )
  const desktop = record(
    notifications.desktop,
    "Notification response.section.data.notifications.desktop",
  )
  exactKeys(desktop, ["enabled"], "Notification response.section.data.notifications.desktop")
  const desktopEnabled = desktop.enabled === undefined ? null : desktop.enabled
  if (desktopEnabled !== expected.desktop.enabled) {
    incompatible(
      "Notification response.section.data.notifications.desktop.enabled is inconsistent with the typed response",
    )
  }
  assertSectionChannelMatches(
    notifications.ntfy,
    {
      enabled: expected.ntfy.enabled,
      baseUrl: expected.ntfy.baseUrl,
      topic: expected.ntfy.topic,
      credential: expected.ntfy.credential,
    },
    "Notification response.section.data.notifications.ntfy",
  )
  assertSectionChannelMatches(
    notifications.bark,
    {
      enabled: expected.bark.enabled,
      baseUrl: expected.bark.baseUrl,
      credential: expected.bark.credential,
    },
    "Notification response.section.data.notifications.bark",
  )
}

/** Validate the complete wire envelope and retain only its safe normalized view. */
export const parseNotificationConfigEnvelope = (value: unknown): NotificationConfigEnvelope => {
  assertSecretFree(value)
  const raw = record(value, "Notification response")
  exactKeys(
    raw,
    [
      "revision",
      "status",
      "source",
      "source_path",
      "loaded_at",
      "last_error",
      "section",
      "credential_revision",
      "credential_status",
      "credential_source",
      "credential_last_error",
      "credential_health",
      "data",
    ],
    "Notification response",
  )

  const revision = nonnegativeInteger(raw.revision, "Notification response.revision")
  const status = enumValue(raw.status, SECTION_STATUSES, "Notification response.status")
  const source = enumValue(raw.source, SECTION_SOURCES, "Notification response.source")
  const sourcePath = nonemptyString(raw.source_path, "Notification response.source_path")
  const loadedAt = timestamp(raw.loaded_at, "Notification response.loaded_at")
  const lastError = nullableString(raw.last_error, "Notification response.last_error")

  const section = record(raw.section, "Notification response.section")
  exactKeys(
    section,
    ["data", "revision", "loaded_at", "source_path", "source_kind", "status", "last_error"],
    "Notification response.section",
  )
  record(section.data, "Notification response.section.data")
  if (
    section.revision !== revision ||
    section.status !== status ||
    section.source_kind !== source ||
    section.source_path !== sourcePath ||
    section.loaded_at !== loadedAt ||
    section.last_error !== lastError
  ) {
    incompatible("Notification response section metadata is inconsistent")
  }

  const credentialRevision = nonnegativeInteger(
    raw.credential_revision,
    "Notification response.credential_revision",
  )
  const credentialStatus = enumValue(
    raw.credential_status,
    SECTION_STATUSES,
    "Notification response.credential_status",
  )
  const credentialSource = enumValue(
    raw.credential_source,
    SECTION_SOURCES,
    "Notification response.credential_source",
  )
  const credentialLastError = nullableString(
    raw.credential_last_error,
    "Notification response.credential_last_error",
  )
  const credentialHealth = record(raw.credential_health, "Notification response.credential_health")
  exactKeys(
    credentialHealth,
    ["revision", "status", "source", "last_error"],
    "Notification response.credential_health",
  )
  if (
    credentialHealth.revision !== credentialRevision ||
    credentialHealth.status !== credentialStatus ||
    credentialHealth.source !== credentialSource ||
    credentialHealth.last_error !== credentialLastError
  ) {
    incompatible("Notification response credential metadata is inconsistent")
  }

  assertReadableAuthority("section", status, source, revision, lastError)
  assertReadableAuthority(
    "credential",
    credentialStatus,
    credentialSource,
    credentialRevision,
    credentialLastError,
  )
  const data = parseData(raw.data)
  if (
    credentialStatus !== "healthy" &&
    (data.ntfy.credential.configured || data.bark.credential.configured)
  ) {
    incompatible("Notification credential state contradicts its authority health")
  }
  assertSectionDataMatches(section.data, data)

  return {
    revision,
    status,
    source,
    sourcePath,
    loadedAt,
    lastError,
    credentialRevision,
    credentialStatus,
    credentialSource,
    credentialLastError,
    data,
  }
}

export const getNotificationChannelsConfig = async (
  options?: RequestInit,
): Promise<NotificationConfigEnvelope> =>
  parseNotificationConfigEnvelope(
    await apiClient.get<unknown>(NOTIFICATION_CONFIG_PATH, options),
  )

const credentialChangeWillMutate = (
  change: CredentialChange,
  current: NotificationCredentialStatus,
): boolean =>
  change.action === "replace" || (change.action === "clear" && current.state !== "missing")

const mutationWillChange = (
  before: NotificationConfigEnvelope,
  data: NotificationMutationData,
): boolean =>
  before.data.desktop.enabled !== data.desktop.enabled ||
  before.data.ntfy.enabled !== data.ntfy.enabled ||
  before.data.ntfy.baseUrl !== data.ntfy.base_url ||
  before.data.ntfy.topic !== data.ntfy.topic ||
  before.data.bark.enabled !== data.bark.enabled ||
  before.data.bark.baseUrl !== data.bark.base_url ||
  credentialChangeWillMutate(data.ntfy.credential_change, before.data.ntfy.credential) ||
  credentialChangeWillMutate(data.bark.credential_change, before.data.bark.credential)

const assertCredentialMutationResult = (
  label: string,
  before: NotificationCredentialStatus,
  change: CredentialChange,
  after: NotificationCredentialStatus,
): void => {
  if (
    change.action === "keep" &&
    (before.credentialRef !== after.credentialRef ||
      (before.state === "missing") !== (after.state === "missing"))
  ) {
    incompatible(`Notification ${label} keep response changed credential metadata`)
  }
  if (
    change.action === "replace" &&
    (!after.configured ||
      after.state !== "configured" ||
      after.source !== "user" ||
      after.credentialRef === null ||
      after.updatedAt === undefined)
  ) {
    incompatible(`Notification ${label} replacement was not installed`)
  }
  if (
    change.action === "clear" &&
    (after.configured || after.state !== "missing" || after.credentialRef !== null)
  ) {
    incompatible(`Notification ${label} credential was not cleared`)
  }
}

const assertMutationResultMatches = (
  before: NotificationConfigEnvelope,
  authority: NotificationConfigEnvelope,
  data: NotificationMutationData,
): void => {
  if (
    authority.data.desktop.enabled !== data.desktop.enabled ||
    authority.data.ntfy.enabled !== data.ntfy.enabled ||
    authority.data.ntfy.baseUrl !== data.ntfy.base_url ||
    authority.data.ntfy.topic !== data.ntfy.topic ||
    authority.data.bark.enabled !== data.bark.enabled ||
    authority.data.bark.baseUrl !== data.bark.base_url
  ) {
    incompatible("Notification mutation response does not match the submitted public data")
  }
  assertCredentialMutationResult(
    "ntfy",
    before.data.ntfy.credential,
    data.ntfy.credential_change,
    authority.data.ntfy.credential,
  )
  assertCredentialMutationResult(
    "Bark",
    before.data.bark.credential,
    data.bark.credential_change,
    authority.data.bark.credential,
  )
}

export const putNotificationChannelsConfig = async (
  before: NotificationConfigEnvelope,
  data: NotificationMutationData,
): Promise<NotificationConfigEnvelope> => {
  const willChange = mutationWillChange(before, data)
  if (!Number.isSafeInteger(before.revision) || before.revision < 0) {
    throw new NotificationConfigContractError("Notification expected revision is invalid")
  }
  if (willChange && before.revision === Number.MAX_SAFE_INTEGER) {
    throw new NotificationConfigContractError("Notification expected revision cannot advance")
  }
  secretFreeHttpUrl(data.ntfy.base_url, "Notification mutation ntfy.base_url")
  secretFreeHttpUrl(data.bark.base_url, "Notification mutation bark.base_url")
  const response = await apiClient.put<unknown>(NOTIFICATION_CONFIG_PATH, {
    expected_revision: before.revision,
    data,
  })
  const authority = parseNotificationConfigEnvelope(response)
  const expectedResultRevision = before.revision + Number(willChange)
  if (authority.revision !== expectedResultRevision) {
    throw new NotificationConfigContractError(
      "Notification mutation returned an unrelated revision",
    )
  }
  assertMutationResultMatches(before, authority, data)
  return authority
}

export const testNotificationChannels = async (): Promise<{
  attempted: string[]
}> => apiClient.post<{ attempted: string[] }>("notifications/test")

export const getNotificationConfigErrorCode = (
  error: unknown,
): NotificationConfigErrorCode | null => {
  if (!isApiError(error) || error.status !== 409 || !error.body) return null
  try {
    const body = JSON.parse(error.body) as unknown
    if (!isRecord(body) || !isRecord(body.error)) return null
    const code = body.error.code
    return code === "config_revision_conflict" || code === "config_recovery_pending"
      ? code
      : null
  } catch {
    return null
  }
}

/** User-facing errors never echo a server body or a submitted credential. */
export const getSafeNotificationErrorMessage = (
  error: unknown,
  submittedCredentials: readonly string[] = [],
): string => {
  void submittedCredentials
  if (error instanceof NotificationConfigContractError) {
    return "通知渠道配置格式与 Lotus Next 不兼容。"
  }
  if (error instanceof NotificationConfigAuthorityError) {
    return "通知渠道配置当前处于不安全的恢复状态，无法安全编辑。"
  }
  if (isApiError(error)) {
    const code = getNotificationConfigErrorCode(error)
    if (code === "config_recovery_pending") {
      return "通知渠道配置正在等待恢复确认，当前不能保存。"
    }
    if (code === "config_revision_conflict") {
      return "通知渠道配置已被其他客户端更新。"
    }
    if (error.status === 401) return "身份验证失败，无法访问通知渠道配置。"
    if (error.status === 403) return "当前身份无权修改通知渠道配置。"
    if (error.status === 404) return "当前 Bamboo 不支持通知渠道分区配置。"
    if (error.status >= 500) return "Bamboo 无法处理通知渠道配置，请稍后重试。"
    return "Bamboo 拒绝了通知渠道设置，请检查输入后重试。"
  }

  if (isRequestError(error)) return getErrorMessage(error)
  return "无法完成通知渠道配置请求，请重试。"
}
