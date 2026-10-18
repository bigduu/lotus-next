import type { ProjectScopeResponse } from "./types"
export const scopeFixture = (): ProjectScopeResponse => ({ code: "project_scope_configured",
  scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 0, allowed_projects: ["p1"] },
  capabilities: { project_scope_v1: true, supervised_root_create_v1: true },
  owner_authorization: { available: true, required: true, kind: "trusted_host_intent", http_registration: false } })
