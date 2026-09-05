import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"

const DIST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist")
const ASSET_MANIFEST_PATH = path.join(DIST_ROOT, "asset-manifest.json")
const FIXTURE_SESSION_ID = "all-surface-session"
const FIXTURE_TIME = "2026-09-03T00:00:00.000Z"

export interface ArtifactScenario {
  readonly name: "standalone" | "embedded" | "secure-remote"
  readonly origin: string
  readonly appPath: string
  readonly entryUrl: string
  readonly embedded: boolean
}

export interface RuntimeObservation {
  readonly scenario: ArtifactScenario["name"]
  readonly httpRequests: Array<{ method: string; url: string }>
  readonly staticUrls: string[]
  readonly apiUrls: string[]
  readonly webSocketUrls: string[]
  readonly webSocketProtocols: string[][]
  readonly clientFrames: unknown[]
  readonly bootstrapDocuments: unknown[]
  readonly webSocketTimeline: Array<{
    readonly ordinal: number
    readonly direction: "client-to-server" | "server-to-client"
    readonly frame: unknown
  }>
  readonly protocolErrors: string[]
  readonly consoleErrors: string[]
  readonly pageErrors: string[]
  readonly failedRequests: string[]
  readonly errorResponses: string[]
  /** Secret-free summaries of the dedicated notification section contract. */
  readonly notificationConfigRequests: Array<{
    readonly method: "GET" | "PUT"
    readonly path: string
    readonly expectedRevision: number | null
    readonly responseRevision: number | null
    readonly ntfyCredentialAction: string | null
    readonly barkCredentialAction: string | null
  }>
}

export interface ArtifactRuntimeOptions {
  /** Override only the canonical provider snapshot for failure-path acceptance. */
  readonly providerInstancesResponse?: unknown
  /** Override only notification GETs; used to exercise malformed authority failure. */
  readonly notificationConfigResponse?: unknown
}

export const standaloneScenario: ArtifactScenario = {
  name: "standalone",
  origin: "http://127.0.0.1:4173",
  appPath: "/",
  entryUrl: "http://127.0.0.1:4173/",
  embedded: false,
}

export const embeddedScenario: ArtifactScenario = {
  name: "embedded",
  origin: "http://127.0.0.1:4174",
  appPath: "/embedded/lotus-next/",
  entryUrl: "http://127.0.0.1:4174/embedded-host.html",
  embedded: true,
}

export const secureRemoteScenario: ArtifactScenario = {
  name: "secure-remote",
  origin: "https://remote.lotus.test",
  appPath: "/",
  entryUrl: "https://remote.lotus.test/",
  embedded: false,
}

const bootstrapDocument = {
  schema_version: 1,
  server: { product: "bamboo", version: "e2e-fixture" },
  api: {
    name: "bamboo.agent",
    canonical_base_path: "/api/v1",
    min_version: 1,
    max_version: 1,
  },
  realtime: {
    name: "bamboo.v2",
    path: "/v2/stream",
    min_version: 2,
    max_version: 2,
    subprotocols: [{ name: "bamboo.v2", encoding: "json" }],
  },
  capabilities: [
    "auth.ws_hello_ack.v1",
    "realtime.account_feed.v1",
    "realtime.agent_events.v1",
    "realtime.application_heartbeat.v1",
    "realtime.feed_cursor.v1",
    "realtime.feed_reset.v1",
    "realtime.stop_control.v1",
  ],
  auth: {
    policy: "open",
    request_state: "unauthenticated",
    password_enabled: false,
    device_auth_enabled: false,
    verify_path: "/api/v1/bamboo/access/verify",
    pair_path: "/v2/pair",
  },
}

const fixtureSession = {
  id: FIXTURE_SESSION_ID,
  kind: "root",
  title: "All-surface acceptance",
  title_version: 1,
  pinned: false,
  parent_session_id: null,
  root_session_id: FIXTURE_SESSION_ID,
  spawn_depth: 0,
  model: "fixture-model",
  model_ref: { provider: "fixture-provider", model: "fixture-model" },
  reasoning_effort: "medium",
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
  last_activity_at: FIXTURE_TIME,
  message_count: 0,
  has_attachments: false,
  is_running: false,
  last_run_status: "completed",
  has_pending_question: false,
  running_child_count: 0,
  placement: { kind: "local", host: "fixture" },
}

const fixtureModel = {
  reference: { provider: "fixture-provider", model: "fixture-model" },
  display_name: "Fixture model",
  provider_display_name: "Fixture provider",
  capabilities: {
    supports_tools: true,
    supports_vision: false,
    supports_reasoning: true,
    supports_streaming: true,
  },
  source: "static",
}

type FixtureNotificationState = {
  revision: number
  credentialRevision: number
  desktopEnabled: boolean | null
  ntfy: { enabled: boolean; baseUrl: string; topic: string; configured: boolean }
  bark: { enabled: boolean; baseUrl: string; configured: boolean }
}

type JsonRecord = Record<string, unknown>
type CredentialAction = "keep" | "replace" | "clear"
const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null

const initialNotificationState = (): FixtureNotificationState => ({
  revision: 7,
  credentialRevision: 3,
  desktopEnabled: null,
  ntfy: { enabled: false, baseUrl: "https://ntfy.sh", topic: "fixture-topic", configured: false },
  bark: { enabled: false, baseUrl: "https://api.day.app", configured: false },
})

const notificationEnvelope = (state: FixtureNotificationState): unknown => {
  const sourcePath = "/fixture/notifications.json"
  const ntfyRef = "notification.ntfy.token"
  const barkRef = "notification.bark.device_key"
  const credential = (configured: boolean, credentialRef: string) =>
    configured
      ? {
          credential_ref: credentialRef,
          state: "configured",
          configured: true,
          source: "user",
          updated_at: FIXTURE_TIME,
        }
      : { credential_ref: null, state: "missing", configured: false }

  return {
    revision: state.revision,
    status: "healthy",
    source: "file",
    source_path: sourcePath,
    loaded_at: FIXTURE_TIME,
    last_error: null,
    section: {
      data: {
        notifications: {
          desktop: state.desktopEnabled === null ? {} : { enabled: state.desktopEnabled },
          ntfy: {
            enabled: state.ntfy.enabled,
            base_url: state.ntfy.baseUrl,
            topic: state.ntfy.topic,
            configured: state.ntfy.configured,
            ...(state.ntfy.configured ? { credential_ref: ntfyRef } : {}),
          },
          bark: {
            enabled: state.bark.enabled,
            base_url: state.bark.baseUrl,
            configured: state.bark.configured,
            ...(state.bark.configured ? { credential_ref: barkRef } : {}),
          },
        },
      },
      revision: state.revision,
      loaded_at: FIXTURE_TIME,
      source_path: sourcePath,
      source_kind: "file",
      status: "healthy",
      last_error: null,
    },
    credential_revision: state.credentialRevision,
    credential_status: "healthy",
    credential_source: "file",
    credential_last_error: null,
    credential_health: {
      revision: state.credentialRevision,
      status: "healthy",
      source: "file",
      last_error: null,
    },
    data: {
      desktop: { enabled: state.desktopEnabled },
      ntfy: {
        enabled: state.ntfy.enabled,
        base_url: state.ntfy.baseUrl,
        topic: state.ntfy.topic,
        credential: credential(state.ntfy.configured, ntfyRef),
      },
      bark: {
        enabled: state.bark.enabled,
        base_url: state.bark.baseUrl,
        credential: credential(state.bark.configured, barkRef),
      },
    },
  }
}

const apiResponse = (method: string, pathnameWithSearch: string): unknown => {
  switch (`${method} ${pathnameWithSearch}`) {
    case "GET /api/v1/bootstrap":
      return bootstrapDocument
    case "GET /api/v1/bamboo/setup/status":
      return {
        is_complete: true,
        has_proxy_config: false,
        has_proxy_env: false,
        message: "",
      }
    case "GET /api/v1/bamboo/settings/provider-instances":
      return {
        default_provider_instance_id: "fixture-provider",
        instances: [
          {
            id: "fixture-provider",
            type: "openai",
            label: "Fixture provider",
            enabled: true,
            config: { model: "fixture-model" },
          },
        ],
        defaults: {
          chat: { provider: "fixture-provider", model: "fixture-model" },
        },
        features: { provider_model_ref: true },
      }
    case "GET /api/v1/sessions":
      return { sessions: [fixtureSession] }
    case "GET /api/v1/runs/active":
      return { sessions: [] }
    case `GET /api/v1/history/${FIXTURE_SESSION_ID}`:
      return { session_id: FIXTURE_SESSION_ID, messages: [] }
    case `GET /api/v1/respond/${FIXTURE_SESSION_ID}/pending`:
      return { has_pending_question: false }
    case "GET /api/v1/health":
      return { status: "ok" }
    case "GET /api/v1/bamboo/config":
      return { proxy_auth_mode: "auto" }
    case "GET /api/v1/notifications/preferences":
      return {
        enabled: true,
        on_clarification: true,
        on_tool_approval: true,
        on_context_pressure: true,
        on_subagent_complete: true,
        on_background_task_complete: true,
        on_run_complete: true,
        on_run_failed: true,
      }
    case "GET /api/v1/metrics/summary":
      return {
        total_sessions: 1,
        total_tokens: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        total_tool_calls: 0,
        active_sessions: 0,
        completed_sessions: 1,
        error_sessions: 0,
        total_tokens_saved: 0,
      }
    case "POST /api/v1/bamboo/provider-catalog/fetch-models":
      return { fetched: [{ provider: "fixture-provider", models: [fixtureModel] }] }
    case "GET /api/v1/bamboo/provider-catalog":
      return { providers: [], models: [fixtureModel] }
    case "GET /api/v1/prompt-presets":
      return { prompts: [] }
    case "GET /api/v1/skills":
      return { skills: [], total: 0 }
    default:
      return undefined
  }
}

export const artifactFileForSource = async (source: string): Promise<string> => {
  const manifest = JSON.parse(await readFile(ASSET_MANIFEST_PATH, "utf8")) as Record<
    string,
    { file?: unknown; src?: unknown }
  >
  const entry = Object.values(manifest).find(({ src }) => src === source)
  if (!entry || typeof entry.file !== "string") {
    throw new Error(`Production asset manifest has no file for ${source}`)
  }
  return entry.file
}

const embeddedHost = (appPath: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Embedded Lotus Next fixture host</title>
    <style>
      html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; }
      body { overflow: hidden; }
    </style>
  </head>
  <body>
    <iframe title="Lotus Next embedded surface" src="${appPath}"></iframe>
  </body>
</html>`

const resolveArtifactPath = async (
  pathname: string,
  appPath: string,
): Promise<string | null> => {
  if (!pathname.startsWith(appPath)) return null
  const relativeUrlPath = pathname.slice(appPath.length) || "index.html"
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(relativeUrlPath)
  } catch {
    return null
  }

  const candidate = path.resolve(DIST_ROOT, decodedPath)
  const relativeFilePath = path.relative(DIST_ROOT, candidate)
  if (relativeFilePath.startsWith("..") || path.isAbsolute(relativeFilePath)) return null

  try {
    return (await stat(candidate)).isFile() ? candidate : null
  } catch {
    return null
  }
}

const parseClientFrame = (message: string | Buffer): unknown => {
  if (typeof message !== "string") {
    return { binary: true, byteLength: message.byteLength }
  }
  try {
    return JSON.parse(message) as unknown
  } catch {
    return { malformed: message }
  }
}

const isExactHello = (frame: unknown): boolean =>
  typeof frame === "object" &&
  frame !== null &&
  !Array.isArray(frame) &&
  Object.keys(frame).length === 1 &&
  "type" in frame &&
  frame.type === "hello"

const isFrameType = (frame: unknown, type: string): boolean =>
  typeof frame === "object" &&
  frame !== null &&
  !Array.isArray(frame) &&
  "type" in frame &&
  frame.type === type

export const installArtifactRuntime = async (
  page: Page,
  scenario: ArtifactScenario,
  historyMessages: readonly unknown[] = [],
  options: ArtifactRuntimeOptions = {},
): Promise<RuntimeObservation> => {
  const observation: RuntimeObservation = {
    scenario: scenario.name,
    httpRequests: [],
    staticUrls: [],
    apiUrls: [],
    webSocketUrls: [],
    webSocketProtocols: [],
    clientFrames: [],
    bootstrapDocuments: [],
    webSocketTimeline: [],
    protocolErrors: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    errorResponses: [],
    notificationConfigRequests: [],
  }
  let notificationState = initialNotificationState()

  page.on("console", (message) => {
    if (message.type() === "error") observation.consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => observation.pageErrors.push(error.message))
  page.on("requestfailed", (request) => {
    observation.failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown failure"}`,
    )
  })
  page.on("response", (response) => {
    if (response.status() >= 400) {
      observation.errorResponses.push(`${response.status()} ${response.url()}`)
    }
  })

  await page.routeWebSocket(/.*/, (webSocket) => {
    observation.webSocketUrls.push(webSocket.url())
    observation.webSocketProtocols.push(webSocket.protocols())
    let welcomeSent = false
    webSocket.onMessage((message) => {
      const frame = parseClientFrame(message)
      observation.clientFrames.push(frame)
      observation.webSocketTimeline.push({
        ordinal: observation.webSocketTimeline.length + 1,
        direction: "client-to-server",
        frame,
      })

      if (isFrameType(frame, "subscribe") && !welcomeSent) {
        observation.protocolErrors.push("client sent subscribe before exact welcome")
      }

      if (isExactHello(frame) && !welcomeSent) {
        const welcome = { type: "welcome" }
        welcomeSent = true
        observation.webSocketTimeline.push({
          ordinal: observation.webSocketTimeline.length + 1,
          direction: "server-to-client",
          frame: welcome,
        })
        webSocket.send(JSON.stringify(welcome))
      } else if (isFrameType(frame, "ping") && welcomeSent) {
        const pong = { type: "pong" }
        observation.webSocketTimeline.push({
          ordinal: observation.webSocketTimeline.length + 1,
          direction: "server-to-client",
          frame: pong,
        })
        webSocket.send(JSON.stringify(pong))
      }
    })
  })

  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    observation.httpRequests.push({ method: request.method(), url: url.href })

    if (url.origin !== scenario.origin) {
      await route.fulfill({
        status: 502,
        json: { error: `Unexpected fixture origin: ${url.origin}` },
      })
      return
    }

    if (url.pathname.startsWith("/api/v1/")) {
      observation.apiUrls.push(url.href)
      if (
        request.method() === "GET" &&
        url.pathname === "/api/v1/bamboo/config/notifications"
      ) {
        const response = options.notificationConfigResponse ?? notificationEnvelope(notificationState)
        const responseRecord = asRecord(response)
        observation.notificationConfigRequests.push({
          method: "GET",
          path: url.pathname,
          expectedRevision: null,
          responseRevision:
            Number.isSafeInteger(responseRecord?.revision)
              ? (responseRecord?.revision as number)
              : null,
          ntfyCredentialAction: null,
          barkCredentialAction: null,
        })
        await route.fulfill({ status: 200, json: response })
        return
      }
      if (
        request.method() === "PUT" &&
        url.pathname === "/api/v1/bamboo/config/notifications"
      ) {
        const body = asRecord(request.postDataJSON() as unknown)
        const data = asRecord(body?.data)
        const desktop = asRecord(data?.desktop)
        const ntfy = asRecord(data?.ntfy)
        const bark = asRecord(data?.bark)
        const ntfyAction = asRecord(ntfy?.credential_change)?.action as CredentialAction
        const barkAction = asRecord(bark?.credential_change)?.action as CredentialAction
        const expectedRevision = body?.expected_revision as number
        const requestSummary = {
          method: "PUT" as const,
          path: url.pathname,
          expectedRevision,
          ntfyCredentialAction: ntfyAction,
          barkCredentialAction: barkAction,
        }
        if (expectedRevision !== notificationState.revision) {
          observation.notificationConfigRequests.push({
            ...requestSummary,
            responseRevision: notificationState.revision,
          })
          await route.fulfill({
            status: 409,
            json: { error: { code: "config_revision_conflict" } },
          })
          return
        }

        const credentialChanged =
          ntfyAction === "replace" ||
          barkAction === "replace" ||
          (ntfyAction === "clear" && notificationState.ntfy.configured) ||
          (barkAction === "clear" && notificationState.bark.configured)
        const publicChanged =
          desktop?.enabled !== notificationState.desktopEnabled ||
          ntfy?.enabled !== notificationState.ntfy.enabled ||
          ntfy?.base_url !== notificationState.ntfy.baseUrl ||
          ntfy?.topic !== notificationState.ntfy.topic ||
          bark?.enabled !== notificationState.bark.enabled ||
          bark?.base_url !== notificationState.bark.baseUrl
        notificationState = {
          revision: notificationState.revision + Number(publicChanged || credentialChanged),
          credentialRevision:
            notificationState.credentialRevision + Number(publicChanged || credentialChanged),
          desktopEnabled: desktop?.enabled as boolean | null,
          ntfy: {
            enabled: ntfy?.enabled as boolean,
            baseUrl: ntfy?.base_url as string,
            topic: ntfy?.topic as string,
            configured:
              ntfyAction === "keep" ? notificationState.ntfy.configured : ntfyAction === "replace",
          },
          bark: {
            enabled: bark?.enabled as boolean,
            baseUrl: bark?.base_url as string,
            configured:
              barkAction === "keep" ? notificationState.bark.configured : barkAction === "replace",
          },
        }
        observation.notificationConfigRequests.push({
          ...requestSummary,
          responseRevision: notificationState.revision,
        })
        await route.fulfill({ status: 200, json: notificationEnvelope(notificationState) })
        return
      }
      if (
        request.method() === "PATCH" &&
        `${url.pathname}${url.search}` === `/api/v1/sessions/${FIXTURE_SESSION_ID}`
      ) {
        await route.fulfill({ status: 200, json: {} })
        return
      }
      if (
        request.method() === "POST" &&
        url.pathname === "/api/v1/bamboo/provider-catalog/fetch-models"
      ) {
        const body = request.postDataJSON() as unknown
        if (
          typeof body !== "object" ||
          body === null ||
          Array.isArray(body) ||
          Object.keys(body).length > 0
        ) {
          await route.fulfill({
            status: 400,
            json: { error: "Provider catalog fixture expects an empty JSON object" },
          })
          return
        }
      }
      const response =
        request.method() === "GET" &&
        url.pathname === "/api/v1/bamboo/settings/provider-instances" &&
        options.providerInstancesResponse !== undefined
          ? options.providerInstancesResponse
          : request.method() === "GET" && url.pathname === `/api/v1/history/${FIXTURE_SESSION_ID}`
            ? { session_id: FIXTURE_SESSION_ID, messages: historyMessages }
            : apiResponse(request.method(), `${url.pathname}${url.search}`)
      if (response === undefined) {
        await route.fulfill({
          status: 501,
          json: { error: `Unimplemented fixture route: ${request.method()} ${url.pathname}` },
        })
        return
      }
      if (request.method() === "GET" && url.pathname === "/api/v1/bootstrap") {
        observation.bootstrapDocuments.push(response)
      }
      await route.fulfill({ status: 200, json: response })
      return
    }

    if (scenario.embedded && url.pathname === "/embedded-host.html") {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: embeddedHost(scenario.appPath),
      })
      return
    }

    const artifactPath = await resolveArtifactPath(url.pathname, scenario.appPath)
    if (artifactPath) {
      observation.staticUrls.push(url.href)
      await route.fulfill({ status: 200, path: artifactPath })
      return
    }

    await route.fulfill({
      status: 404,
      json: { error: `Artifact path not found: ${url.pathname}` },
    })
  })

  return observation
}
