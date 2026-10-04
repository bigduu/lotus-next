import { uiText } from "@shared/i18n/ui"
import { apiClient } from "../api"
import { isApiError } from "../api/errors"

export type WorkflowSource = "builtin" | "project" | "workspace" | "user" | "plugin"
export type WorkflowSelection = { id: string; source: WorkflowSource; revision: number; args: unknown }
export type WorkflowCatalogEntry = {
  id: string; name: string; description: string
  kind: "instruction" | "orchestration"; source: WorkflowSource; revision: number
  status: "valid" | "invalid"; winner: boolean
  invocation_policy: Record<string, unknown>; argument_schema: Record<string, unknown>
  last_error?: string
}
export type WorkflowCatalog = { revision: number; entries: WorkflowCatalogEntry[] }
export type TypedWorkflowDraft = { entry: WorkflowCatalogEntry; argsText: string }

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const owns = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key)
const sources: readonly unknown[] = ["builtin", "project", "workspace", "user", "plugin"]
const types = ["null", "boolean", "object", "array", "number", "integer", "string"]
const keywords = ["type", "enum", "required", "properties", "additionalProperties", "items", "minimum", "maximum", "x-bamboo-secret"]

// Matches Bamboo domain/workflow/schema.rs, including its intentionally small
// supported vocabulary. The backend still validates the pinned definition.
export function validateWorkflowSchema(schema: unknown, depth = 0): asserts schema is Record<string, unknown> {
  if (!object(schema) || depth > 64) throw new Error(uiText("workflow_argument_schema_is_invalid_or_nested_too_deepl_0c87fbc3"))
  if (Object.keys(schema).some((key) => !keywords.includes(key))) throw new Error(uiText("workflow_argument_schema_contains_unsupported_fields_9f3bb3e8"))
  if (owns(schema, "type")) {
    const kinds = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!kinds.length || kinds.some((kind) => typeof kind !== "string" || !types.includes(kind))) throw new Error(uiText("invalid_workflow_argument_schema_type_9ac09619"))
  }
  if (owns(schema, "enum") && !Array.isArray(schema.enum)) throw new Error(uiText("invalid_workflow_argument_enum_4497e77c"))
  if (owns(schema, "required") && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))) throw new Error(uiText("invalid_workflow_argument_required_field_0b3cef52"))
  for (const key of ["additionalProperties", "x-bamboo-secret"]) {
    if (owns(schema, key) && typeof schema[key] !== "boolean") throw new Error(uiText("invalid_workflow_argument_5852bc3d", { v0: key }))
  }
  for (const key of ["minimum", "maximum"]) {
    if (owns(schema, key) && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw new Error(uiText("invalid_workflow_argument_5852bc3d", { v0: key }))
  }
  if (owns(schema, "properties")) {
    if (!object(schema.properties)) throw new Error(uiText("invalid_workflow_argument_properties_c77be493"))
    Object.values(schema.properties).forEach((child) => validateWorkflowSchema(child, depth + 1))
  }
  if (owns(schema, "items")) validateWorkflowSchema(schema.items, depth + 1)
}

function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equalJson(value, b[i]))
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => owns(b, key) && equalJson(a[key], b[key]))
  return false
}
function matchesType(kind: unknown, value: unknown): boolean {
  switch (kind) {
    case "null": return value === null
    case "boolean": return typeof value === "boolean"
    case "object": return object(value)
    case "array": return Array.isArray(value)
    case "number": return typeof value === "number" && Number.isFinite(value)
    case "integer": return typeof value === "number" && Number.isSafeInteger(value)
    case "string": return typeof value === "string"
    default: return false
  }
}
function validateArgs(schema: Record<string, unknown>, value: unknown, path = "$"): void {
  if (schema["x-bamboo-secret"] === true) {
    if (!object(value) || Object.keys(value).length !== 1 || typeof value.$secret !== "string" || !value.$secret.trim()) throw new Error(uiText("a_secret_capability_handle_is_required_1cffbac1", { v0: path }))
    return
  }
  if (owns(schema, "type")) {
    const kinds = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!kinds.some((kind) => matchesType(kind, value))) throw new Error(uiText("argument_type_mismatch_0bb5e576", { v0: path }))
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((choice) => equalJson(choice, value))) throw new Error(uiText("argument_is_not_in_enum_0748dbaf", { v0: path }))
  if (Array.isArray(schema.required)) {
    if (!object(value)) throw new Error(uiText("required_needs_an_object_8e2231fb", { v0: path }))
    for (const key of schema.required as string[]) if (!owns(value, key)) throw new Error(uiText("missing_required_argument_ceedfa5d", { v0: path, v1: key }))
  }
  if (object(value)) {
    const properties = object(schema.properties) ? schema.properties : {}
    for (const [key, child] of Object.entries(value)) {
      if (owns(properties, key)) validateArgs(properties[key] as Record<string, unknown>, child, `${path}/${key}`)
      else if (schema.additionalProperties === false) throw new Error(uiText("argument_is_not_allowed_8c36b898", { v0: path, v1: key }))
    }
  }
  if (Array.isArray(value) && object(schema.items)) value.forEach((child, i) => validateArgs(schema.items as Record<string, unknown>, child, `${path}/${i}`))
  for (const [key, valid] of [["minimum", (a: number, b: number) => a >= b], ["maximum", (a: number, b: number) => a <= b]] as const) {
    if (typeof schema[key] === "number" && (typeof value !== "number" || !valid(value, schema[key]))) throw new Error(uiText("argument_does_not_match_642d0492", { v0: path, v1: key }))
  }
}

export function parseWorkflowCatalog(value: unknown): WorkflowCatalog {
  if (!object(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.entries)) throw new Error(uiText("invalid_bamboo_workflow_catalog_format_2237455b"))
  const entries = value.entries.map((raw) => {
    if (!object(raw) || typeof raw.id !== "string" || !raw.id.trim() || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.description !== "string"
      || !["instruction", "orchestration"].includes(raw.kind as string) || !sources.includes(raw.source)
      || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || !["valid", "invalid"].includes(raw.status as string)
      || typeof raw.winner !== "boolean" || !object(raw.invocation_policy) || (owns(raw.invocation_policy, "explicit") && typeof raw.invocation_policy.explicit !== "boolean")
      || (raw.last_error !== undefined && typeof raw.last_error !== "string")) throw new Error(uiText("invalid_bamboo_workflow_entry_format_a19c4cb3"))
    // Invalid entries retain diagnostics, but cannot become typed selections.
    if (raw.status === "valid") validateWorkflowSchema(raw.argument_schema)
    if (!object(raw.argument_schema)) throw new Error(uiText("invalid_bamboo_workflow_argument_schema_format_0ca9f6be"))
    return { id: raw.id, name: raw.name, description: raw.description, kind: raw.kind,
      source: raw.source, revision: raw.revision, status: raw.status, winner: raw.winner,
      invocation_policy: raw.invocation_policy, argument_schema: raw.argument_schema,
      ...(raw.last_error === undefined ? {} : { last_error: raw.last_error }) } as WorkflowCatalogEntry
  })
  return { revision: value.revision as number, entries }
}

export function workflowUnavailableReason(entry: WorkflowCatalogEntry): string | null {
  if (entry.status !== "valid") return entry.last_error || uiText("invalid_definition_d28c9eaf")
  if (!entry.winner) return uiText("not_the_active_source_ed72c73c")
  if (entry.revision <= 0) return uiText("no_sendable_revision_119eaea0")
  if (entry.kind !== "instruction") return uiText("orchestration_workflows_require_the_workflow_run_api_f7631380")
  if (entry.invocation_policy.explicit !== true) return uiText("explicit_selection_is_not_allowed_ac1f6f64")
  return null
}

export function prepareWorkflowSelection(draft: TypedWorkflowDraft): WorkflowSelection {
  const reason = workflowUnavailableReason(draft.entry)
  if (reason) throw new Error(reason)
  validateWorkflowSchema(draft.entry.argument_schema)
  let args: unknown
  try { args = JSON.parse(draft.argsText) } catch { throw new Error(uiText("workflow_arguments_must_be_valid_json_6fedffe3")) }
  // JSON.parse can produce Infinity or round integers before HTTP JSON
  // encoding. Reject them even when the catalog has an unconstrained schema.
  const pending = [args]
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error(uiText("workflow_argument_numbers_must_be_finite_integers_must__06042926"))
    if (Array.isArray(value)) for (const child of value) pending.push(child)
    else if (object(value)) for (const child of Object.values(value)) pending.push(child)
  }
  validateArgs(draft.entry.argument_schema, args)
  return { id: draft.entry.id, source: draft.entry.source, revision: draft.entry.revision, args }
}

export async function getWorkflowCatalog(sessionId: string | null, signal?: AbortSignal): Promise<WorkflowCatalog> {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""
  return parseWorkflowCatalog(await apiClient.get<unknown>(`/bamboo/workflow-catalog${query}`, { signal }))
}

export function workflowSubmissionError(error: unknown): { code: string; message: string } | null {
  if (!isApiError(error) || !error.body) return null
  try {
    const body = JSON.parse(error.body) as { error?: { code?: unknown; message?: unknown } }
    const code = body.error?.code
    if (typeof code !== "string" || (!code.startsWith("workflow_") && code !== "root_orchestration_incompatible_mode")) return null
    return { code, message: typeof body.error?.message === "string" ? body.error.message : error.message }
  } catch { return null }
}
