import { apiClient, isApiError } from "../api"

export const JIANDU_MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const
export const JIANDU_MEMORY_STATUSES = [
  "active",
  "stale",
  "superseded",
  "contradicted",
  "archived",
] as const
export const JIANDU_MEMORY_GRANULARITIES = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
] as const

export const JIANDU_MEMORY_LIMITS = {
  queryChars: 512,
  pageSize: 20,
  titleChars: 160,
  bodyChars: 4_000,
  tags: 32,
  tagChars: 64,
  keywords: 32,
  entities: 16,
  retrievalTermChars: 96,
  detailChars: 6_000,
} as const

export type JianduMemoryType = (typeof JIANDU_MEMORY_TYPES)[number]
export type JianduMemoryStatus = (typeof JIANDU_MEMORY_STATUSES)[number]
export type JianduMemoryGranularity = (typeof JIANDU_MEMORY_GRANULARITIES)[number]

export type JianduMemoryErrorCode =
  | "invalid_input"
  | "context_unavailable"
  | "access_denied"
  | "request_failed"
  | "action_rejected"
  | "malformed_response"

export class JianduMemoryApiError extends Error {
  constructor(readonly code: JianduMemoryErrorCode) {
    super(code)
    this.name = "JianduMemoryApiError"
  }
}

export interface JianduProjectContext {
  activeSessionId: string
  activeSessionTitle: string
  authoritySessionId: string
  authoritySessionTitle: string
  projectId: string
}

export interface JianduMemoryListItem {
  id: string
  title: string
  type: JianduMemoryType
  status: JianduMemoryStatus
  summary: string
  tags: string[]
  granularity?: JianduMemoryGranularity
}

export interface JianduMemoryPage {
  items: JianduMemoryListItem[]
  returnedCount: number
  matchedCount: number
  remainingCount: number
  truncated: boolean
  nextCursor?: string
}

export interface JianduMemoryDetail extends JianduMemoryListItem {
  body: string
  bodyTruncated: boolean
  retrievalMetadataTruncated: boolean
  createdAt: string
  updatedAt: string
  keywords: string[]
  entities: string[]
}

export interface CreateProjectMemoryInput {
  title: string
  type: JianduMemoryType
  content: string
  tags?: string[]
  keywords?: string[]
  entities?: string[]
  granularity?: JianduMemoryGranularity
}

export interface CreatedProjectMemory {
  id: string
  title: string
  type: JianduMemoryType
  status: JianduMemoryStatus
}

export interface QueryProjectMemoriesInput {
  query?: string
  cursor?: string
  limit?: number
  filters?: {
    type?: JianduMemoryType[]
    status?: JianduMemoryStatus[]
    granularity?: JianduMemoryGranularity[]
  }
}

export interface JianduMemoryApiClient {
  resolveProjectContext(activeSessionId: string): Promise<JianduProjectContext>
  queryProjectMemories(
    context: JianduProjectContext,
    input?: QueryProjectMemoriesInput,
  ): Promise<JianduMemoryPage>
  getProjectMemory(context: JianduProjectContext, id: string): Promise<JianduMemoryDetail>
  createProjectMemory(
    context: JianduProjectContext,
    input: CreateProjectMemoryInput,
  ): Promise<CreatedProjectMemory>
  archiveProjectMemory(context: JianduProjectContext, id: string): Promise<void>
}

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const fail = (code: JianduMemoryErrorCode): never => {
  throw new JianduMemoryApiError(code)
}

const requiredRecord = (value: unknown): JsonRecord =>
  isRecord(value) ? value : fail("malformed_response")

const requiredString = (record: JsonRecord, key: string): string => {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : fail("malformed_response")
}

const optionalString = (record: JsonRecord, key: string): string | undefined => {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  return typeof value === "string" && value.length > 0 ? value : fail("malformed_response")
}

const requiredBoolean = (record: JsonRecord, key: string): boolean =>
  typeof record[key] === "boolean" ? (record[key] as boolean) : fail("malformed_response")

const requiredCount = (record: JsonRecord, key: string): number => {
  const value = record[key]
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fail("malformed_response")
}

const stringArray = (value: unknown): string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return fail("malformed_response")
  }
  return value
}

const oneOf = <T extends string>(value: unknown, values: readonly T[]): T =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fail("malformed_response")

const parseJsonRecord = (value: string): JsonRecord => {
  try {
    return requiredRecord(JSON.parse(value) as unknown)
  } catch (error) {
    if (error instanceof JianduMemoryApiError) throw error
    return fail("malformed_response")
  }
}

const safeRequestError = (error: unknown, contextRequest: boolean): never => {
  if (isApiError(error)) {
    if (error.status === 401 || error.status === 403) return fail("access_denied")
    if (contextRequest && error.status === 404) return fail("context_unavailable")
    if (!contextRequest) return fail("action_rejected")
  }
  return fail("request_failed")
}

interface SessionContextRecord {
  id: string
  kind: "root" | "child"
  rootSessionId: string
  projectId?: string
  title: string
}

const parseSession = (payload: unknown, requestedId: string): SessionContextRecord => {
  const session = requiredRecord(requiredRecord(payload).session)
  const id = requiredString(session, "id")
  if (id !== requestedId) return fail("malformed_response")
  const kind = oneOf(session.kind, ["root", "child"] as const)
  const rootSessionId = requiredString(session, "root_session_id")
  const rawProjectId = session.project_id
  const projectId =
    rawProjectId === undefined || rawProjectId === null
      ? undefined
      : typeof rawProjectId === "string" && rawProjectId.trim().length > 0
        ? rawProjectId.trim()
        : fail("malformed_response")
  return { id, kind, rootSessionId, projectId, title: requiredString(session, "title") }
}

const assertProjectContext = (context: JianduProjectContext): void => {
  if (
    !context.activeSessionId.trim() ||
    !context.authoritySessionId.trim() ||
    !context.projectId.trim()
  ) {
    fail("context_unavailable")
  }
}

const validateProjectIdentity = (record: JsonRecord, context: JianduProjectContext): void => {
  if (record.scope !== "project") return fail("malformed_response")
  const projectKey = record.project_key
  if (projectKey !== undefined && projectKey !== null && projectKey !== context.projectId) {
    fail("malformed_response")
  }
}

const parseListItem = (
  value: unknown,
  context: JianduProjectContext,
): JianduMemoryListItem => {
  const record = requiredRecord(value)
  validateProjectIdentity(record, context)
  const granularity = optionalString(record, "granularity")
  return {
    id: requiredString(record, "id"),
    title: requiredString(record, "title"),
    type: oneOf(record.type, JIANDU_MEMORY_TYPES),
    status: oneOf(record.status, JIANDU_MEMORY_STATUSES),
    summary: typeof record.summary === "string" ? record.summary : fail("malformed_response"),
    tags: stringArray(record.tags),
    ...(granularity
      ? { granularity: oneOf(granularity, JIANDU_MEMORY_GRANULARITIES) }
      : {}),
  }
}

const normalizeTerms = (
  values: string[] | undefined,
  maxItems: number,
  maxChars: number,
): string[] => {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
  if (normalized.length > maxItems || normalized.some((value) => [...value].length > maxChars)) {
    return fail("invalid_input")
  }
  return normalized
}

export const normalizeCreateProjectMemoryInput = (
  input: CreateProjectMemoryInput,
): Required<Omit<CreateProjectMemoryInput, "granularity">> & {
  granularity?: JianduMemoryGranularity
} => {
  const title = input.title.trim()
  const content = input.content.trim()
  if (
    !title ||
    !content ||
    [...title].length > JIANDU_MEMORY_LIMITS.titleChars ||
    [...content].length > JIANDU_MEMORY_LIMITS.bodyChars ||
    !JIANDU_MEMORY_TYPES.includes(input.type)
  ) {
    return fail("invalid_input")
  }
  if (
    input.granularity !== undefined &&
    !JIANDU_MEMORY_GRANULARITIES.includes(input.granularity)
  ) {
    return fail("invalid_input")
  }
  return {
    title,
    content,
    type: input.type,
    tags: normalizeTerms(input.tags, JIANDU_MEMORY_LIMITS.tags, JIANDU_MEMORY_LIMITS.tagChars),
    keywords: normalizeTerms(
      input.keywords,
      JIANDU_MEMORY_LIMITS.keywords,
      JIANDU_MEMORY_LIMITS.retrievalTermChars,
    ),
    entities: normalizeTerms(
      input.entities,
      JIANDU_MEMORY_LIMITS.entities,
      JIANDU_MEMORY_LIMITS.retrievalTermChars,
    ),
    ...(input.granularity ? { granularity: input.granularity } : {}),
  }
}

export const createLookupQuery = (input: CreateProjectMemoryInput): string => {
  const normalized = normalizeCreateProjectMemoryInput(input)
  return Array.from(
    [normalized.title, ...normalized.keywords, ...normalized.entities].join(" "),
  )
    .slice(0, JIANDU_MEMORY_LIMITS.queryChars)
    .join("")
}

const parameter = (name: string, value: unknown) => ({ name, value: JSON.stringify(value) })

export class JianduMemoryApi implements JianduMemoryApiClient {
  private async getSession(sessionId: string): Promise<SessionContextRecord> {
    try {
      const payload = await apiClient.get<unknown>(`sessions/${encodeURIComponent(sessionId)}`)
      return parseSession(payload, sessionId)
    } catch (error) {
      if (error instanceof JianduMemoryApiError) throw error
      return safeRequestError(error, true)
    }
  }

  async resolveProjectContext(activeSessionId: string): Promise<JianduProjectContext> {
    const requestedId = activeSessionId.trim()
    if (!requestedId) return fail("context_unavailable")
    const active = await this.getSession(requestedId)
    const root = active.kind === "child" ? await this.getSession(active.rootSessionId) : active
    if (root.kind !== "root" || root.rootSessionId !== root.id || !root.projectId) {
      return fail("context_unavailable")
    }
    if (active.projectId !== root.projectId) {
      return fail("context_unavailable")
    }
    return {
      activeSessionId: active.id,
      activeSessionTitle: active.title,
      authoritySessionId: root.id,
      authoritySessionTitle: root.title,
      projectId: root.projectId,
    }
  }

  private async execute(
    context: JianduProjectContext,
    action: "query" | "get" | "write" | "purge",
    values: ReadonlyArray<readonly [string, unknown]>,
  ): Promise<JsonRecord> {
    assertProjectContext(context)
    try {
      const outer = requiredRecord(
        await apiClient.post<unknown>("tools/execute", {
          tool_name: "memory",
          session_id: context.authoritySessionId,
          parameters: [["action", action] as const, ...values].map(([name, value]) =>
            parameter(name, value),
          ),
        }),
      )
      const toolResult = parseJsonRecord(requiredString(outer, "result"))
      if (
        toolResult.tool_name !== "memory" ||
        typeof toolResult.display_preference !== "string"
      ) {
        return fail("malformed_response")
      }
      if (toolResult.success !== true) return fail("action_rejected")
      const result = parseJsonRecord(requiredString(toolResult, "result"))
      if (result.action !== action) return fail("malformed_response")
      return result
    } catch (error) {
      if (error instanceof JianduMemoryApiError) throw error
      return safeRequestError(error, false)
    }
  }

  async queryProjectMemories(
    context: JianduProjectContext,
    input: QueryProjectMemoriesInput = {},
  ): Promise<JianduMemoryPage> {
    const query = input.query?.trim() ?? ""
    const limit = input.limit ?? JIANDU_MEMORY_LIMITS.pageSize
    if (
      [...query].length > JIANDU_MEMORY_LIMITS.queryChars ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > JIANDU_MEMORY_LIMITS.pageSize
    ) {
      return fail("invalid_input")
    }
    const filters = input.filters
      ? {
          type: filtersOrEmpty(input.filters.type, JIANDU_MEMORY_TYPES),
          status: filtersOrEmpty(input.filters.status, JIANDU_MEMORY_STATUSES),
          granularity: filtersOrEmpty(
            input.filters.granularity,
            JIANDU_MEMORY_GRANULARITIES,
          ),
        }
      : undefined
    const cursor = input.cursor?.trim()
    if (input.cursor !== undefined && (!cursor || cursor.length > 2_048)) {
      return fail("invalid_input")
    }
    const options = {
      limit,
      ...(cursor ? { cursor } : {}),
    }
    const result = await this.execute(context, "query", [
      ["scope", "project"],
      ["query", query],
      ...(filters ? ([["filters", filters]] as const) : []),
      ["options", options],
    ])
    if (result.success !== true) return fail("action_rejected")
    const data = requiredRecord(result.data)
    if (!Array.isArray(data.items)) return fail("malformed_response")
    const items = data.items.map((item) => parseListItem(item, context))
    const returnedCount = requiredCount(data, "returned_count")
    const matchedCount = requiredCount(data, "matched_count")
    const remainingCount = requiredCount(data, "remaining_count")
    if (returnedCount !== items.length || returnedCount > matchedCount) {
      return fail("malformed_response")
    }
    const nextCursor = optionalString(data, "next_cursor")
    return {
      items,
      returnedCount,
      matchedCount,
      remainingCount,
      truncated: requiredBoolean(data, "truncated"),
      ...(nextCursor ? { nextCursor } : {}),
    }
  }

  async getProjectMemory(
    context: JianduProjectContext,
    id: string,
  ): Promise<JianduMemoryDetail> {
    const memoryId = validId(id)
    const result = await this.execute(context, "get", [
      ["id", memoryId],
      ["options", { max_chars: JIANDU_MEMORY_LIMITS.detailChars }],
    ])
    if (requiredString(result, "id") !== memoryId) return fail("malformed_response")
    const memory = requiredRecord(result.memory)
    const frontmatter = requiredRecord(memory.frontmatter)
    if (requiredString(frontmatter, "id") !== memoryId) return fail("malformed_response")
    validateProjectIdentity(frontmatter, context)
    const retrieval = requiredRecord(frontmatter.retrieval)
    const granularity = optionalString(frontmatter, "granularity")
    return {
      id: memoryId,
      title: requiredString(frontmatter, "title"),
      type: oneOf(frontmatter.type, JIANDU_MEMORY_TYPES),
      status: oneOf(frontmatter.status, JIANDU_MEMORY_STATUSES),
      summary: "",
      tags: stringArray(frontmatter.tags),
      ...(granularity
        ? { granularity: oneOf(granularity, JIANDU_MEMORY_GRANULARITIES) }
        : {}),
      body: typeof memory.body === "string" ? memory.body : fail("malformed_response"),
      bodyTruncated: requiredBoolean(memory, "body_truncated"),
      retrievalMetadataTruncated: requiredBoolean(memory, "retrieval_metadata_truncated"),
      createdAt: requiredString(frontmatter, "created_at"),
      updatedAt: requiredString(frontmatter, "updated_at"),
      keywords: stringArray(retrieval.keywords),
      entities: stringArray(retrieval.entities),
    }
  }

  async createProjectMemory(
    context: JianduProjectContext,
    input: CreateProjectMemoryInput,
  ): Promise<CreatedProjectMemory> {
    const normalized = normalizeCreateProjectMemoryInput(input)
    const values: Array<readonly [string, unknown]> = [
      ["scope", "project"],
      ["type", normalized.type],
      ["title", normalized.title],
      ["content", normalized.content],
      ["tags", normalized.tags],
      ["keywords", normalized.keywords],
      ["entities", normalized.entities],
    ]
    if (normalized.granularity) values.push(["granularity", normalized.granularity])
    values.push(["options", { allow_merge_if_similar: false }])
    const result = await this.execute(context, "write", values)
    const memory = requiredRecord(result.memory)
    validateProjectIdentity(memory, context)
    const status = oneOf(memory.status, JIANDU_MEMORY_STATUSES)
    const title = requiredString(memory, "title")
    const type = oneOf(memory.type, JIANDU_MEMORY_TYPES)
    if (status !== "active" || title !== normalized.title || type !== normalized.type) {
      return fail("malformed_response")
    }
    return {
      id: requiredString(memory, "id"),
      title,
      type,
      status,
    }
  }

  async archiveProjectMemory(context: JianduProjectContext, id: string): Promise<void> {
    const memoryId = validId(id)
    const result = await this.execute(context, "purge", [
      ["id", memoryId],
      ["mode", "archived"],
    ])
    if (requiredString(result, "id") !== memoryId || result.status !== "archived") {
      return fail("malformed_response")
    }
  }
}

const filtersOrEmpty = <T extends string>(values: T[] | undefined, allowed: readonly T[]): T[] => {
  const result = values ?? []
  if (!result.every((value) => allowed.includes(value))) return fail("invalid_input")
  return result
}

const validId = (id: string): string => {
  const value = id.trim()
  if (!value || [...value].length > 128) return fail("invalid_input")
  return value
}

export const sameJianduProjectContext = (
  left: JianduProjectContext,
  right: JianduProjectContext,
): boolean =>
  left.activeSessionId === right.activeSessionId &&
  left.authoritySessionId === right.authoritySessionId &&
  left.projectId === right.projectId

export const jianduMemoryApi = new JianduMemoryApi()
