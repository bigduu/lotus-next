import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(
      `Missing required real-Bamboo environment variable: ${name}`,
    );
  return value;
};

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const fetchJson = async (
  url: URL,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await response.json()) as unknown;
  return { status: response.status, body };
};

const requiredRecord = (value: unknown, label: string): JsonRecord => {
  const record = asRecord(value);
  if (!record) throw new Error(`${label} was not a JSON object`);
  return record;
};

const parseRecord = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "string") {
    throw new Error(`${label} was not a JSON string`);
  }
  try {
    return requiredRecord(JSON.parse(value) as unknown, label);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} was invalid JSON`);
    throw error;
  }
};

const executeMemory = async (
  baseUrl: URL,
  sessionId: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<JsonRecord> => {
  const response = await fetchJson(new URL("/api/v1/tools/execute", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool_name: "memory",
      session_id: sessionId,
      parameters: Object.entries(parameters).map(([name, value]) => ({
        name,
        value: JSON.stringify(value),
      })),
    }),
  });
  expect(response.status).toBe(200);
  const outer = requiredRecord(response.body, "memory HTTP response");
  const tool = parseRecord(outer.result, "memory tool result");
  expect(tool.tool_name).toBe("memory");
  expect(tool.success).toBe(true);
  expect(typeof tool.display_preference).toBe("string");
  const result = parseRecord(tool.result, "memory action result");
  expect(result.action).toBe(parameters.action);
  return result;
};

const queryMemory = async (
  baseUrl: URL,
  sessionId: string,
  query: string,
  limit = 20,
): Promise<{ data: JsonRecord; items: JsonRecord[] }> => {
  const result = await executeMemory(baseUrl, sessionId, {
    action: "query",
    scope: "project",
    query,
    options: { limit },
  });
  expect(result.success).toBe(true);
  const data = requiredRecord(result.data, "memory query data");
  if (!Array.isArray(data.items)) throw new Error("memory query items was not an array");
  const items = data.items.map((item) => requiredRecord(item, "memory query item"));
  expect(data.returned_count).toBe(items.length);
  expect(Number.isInteger(data.matched_count)).toBe(true);
  expect(Number.isInteger(data.remaining_count)).toBe(true);
  expect(typeof data.truncated).toBe("boolean");
  return { data, items };
};

test("source-built isolated Bamboo runtime exposes the canonical contract", async () => {
  const baseUrl = new URL(requiredEnvironment("LOTUS_REAL_BAMBOO_BASE_URL"));
  const sessionId = requiredEnvironment("LOTUS_REAL_BAMBOO_SESSION_ID");
  const revision = requiredEnvironment("LOTUS_REAL_BAMBOO_REVISION");
  const observationsPath = requiredEnvironment(
    "LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH",
  );

  expect(baseUrl.protocol).toBe("http:");
  expect(baseUrl.hostname).toBe("127.0.0.1");
  expect(revision).toBe("49c6f3b8b4d0f72674f888aa3abcef7cd91cd372");
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(path.isAbsolute(observationsPath)).toBe(true);

  const ready = await fetchJson(new URL("/readyz", baseUrl));
  expect(ready.status).toBe(200);
  expect(asRecord(ready.body)?.status).toBe("ok");

  const bootstrap = await fetchJson(new URL("/api/v1/bootstrap", baseUrl));
  const bootstrapBody = asRecord(bootstrap.body);
  expect(bootstrap.status).toBe(200);
  expect(bootstrapBody?.schema_version).toBe(1);
  expect(asRecord(bootstrapBody?.server)?.product).toBe("bamboo");
  expect(asRecord(bootstrapBody?.api)?.canonical_base_path).toBe("/api/v1");
  expect(asRecord(bootstrapBody?.realtime)?.path).toBe("/v2/stream");
  expect(
    Array.isArray(bootstrapBody?.capabilities)
      ? bootstrapBody.capabilities.filter(
          (capability) => capability === "auth.ws_hello_ack.v1",
        )
      : [],
  ).toHaveLength(1);

  const history = await fetchJson(
    new URL(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/history`,
      baseUrl,
    ),
  );
  expect(history.status).toBe(200);
  expect(Array.isArray(asRecord(history.body)?.messages)).toBe(true);

  const observations = asRecord(
    JSON.parse(await readFile(observationsPath, "utf8")) as unknown,
  );
  const requests = observations?.requests;
  expect(observations?.schemaVersion).toBe(1);
  expect(Array.isArray(requests)).toBe(true);
  if (!Array.isArray(requests))
    throw new Error("Provider requests must be an array");
  expect(observations?.requestCount).toBe(2);
  expect(requests).toHaveLength(2);
  const smokeRequest = asRecord(requests[0]);
  expect(smokeRequest?.method).toBe("POST");
  expect(smokeRequest?.path).toBe("/v1/chat/completions");
  expect(smokeRequest?.model).toBe("gpt-4o-mini");
  expect(smokeRequest?.stream).toBe(true);
  expect(smokeRequest?.userMarkerPresent).toBe(false);
  expect(smokeRequest?.smokeMarkerPresent).toBe(true);
  const rejectionRequest = asRecord(requests[1]);
  expect(rejectionRequest?.method).toBe("POST");
  expect(rejectionRequest?.path).toBe("/v1/chat/completions");
  expect(rejectionRequest?.model).toBeNull();
  expect(rejectionRequest?.stream).toBe(true);
  expect(rejectionRequest?.userMarkerPresent).toBe(false);
  expect(rejectionRequest?.smokeMarkerPresent).toBe(true);
});

test("native memory tool keeps Project records isolated through archive", async () => {
  const baseUrl = new URL(requiredEnvironment("LOTUS_REAL_BAMBOO_BASE_URL"));
  const chatSessionId = requiredEnvironment("LOTUS_REAL_BAMBOO_SESSION_ID");
  const primarySessionId = requiredEnvironment(
    "LOTUS_REAL_BAMBOO_MEMORY_SESSION_ID",
  );
  const otherSessionId = requiredEnvironment(
    "LOTUS_REAL_BAMBOO_OTHER_PROJECT_SESSION_ID",
  );
  expect(new Set([chatSessionId, primarySessionId, otherSessionId]).size).toBe(3);
  const primarySessionResponse = await fetchJson(
    new URL(`/api/v1/sessions/${encodeURIComponent(primarySessionId)}`, baseUrl),
  );
  const otherSessionResponse = await fetchJson(
    new URL(`/api/v1/sessions/${encodeURIComponent(otherSessionId)}`, baseUrl),
  );
  expect(primarySessionResponse.status).toBe(200);
  expect(otherSessionResponse.status).toBe(200);
  const primarySession = requiredRecord(
    requiredRecord(primarySessionResponse.body, "primary session response").session,
    "primary session",
  );
  const otherSession = requiredRecord(
    requiredRecord(otherSessionResponse.body, "other session response").session,
    "other session",
  );
  expect(primarySession).toMatchObject({
    id: primarySessionId,
    kind: "root",
    root_session_id: primarySessionId,
  });
  expect(otherSession).toMatchObject({
    id: otherSessionId,
    kind: "root",
    root_session_id: otherSessionId,
  });
  const primaryProjectId = primarySession.project_id;
  const otherProjectId = otherSession.project_id;
  expect(typeof primaryProjectId).toBe("string");
  expect(typeof otherProjectId).toBe("string");
  expect(primaryProjectId).not.toBe(otherProjectId);

  const empty = await queryMemory(baseUrl, primarySessionId, "", 1);
  expect(empty.items).toEqual([]);
  expect(empty.data).toMatchObject({
    returned_count: 0,
    matched_count: 0,
    remaining_count: 0,
    truncated: false,
  });

  const primaryToken = `primary${primarySessionId.replaceAll("-", "")}`;
  const primaryTitle = `Memory ${primaryToken}`;
  const primaryBody = `Only the primary Project can read ${primaryToken}.`;
  const primaryWrite = await executeMemory(baseUrl, primarySessionId, {
    action: "write",
    scope: "project",
    type: "project",
    title: primaryTitle,
    content: primaryBody,
    tags: ["e2e-primary"],
    keywords: [primaryToken],
    entities: ["Jiandu"],
    options: { allow_merge_if_similar: false },
  });
  const primaryReceipt = requiredRecord(primaryWrite.memory, "primary write receipt");
  expect(primaryReceipt).toMatchObject({
    title: primaryTitle,
    type: "project",
    scope: "project",
    status: "active",
    project_key: primaryProjectId,
  });
  const primaryId = primaryReceipt.id;
  expect(typeof primaryId).toBe("string");

  const primaryFound = await queryMemory(baseUrl, primarySessionId, primaryToken);
  expect(primaryFound.data).toMatchObject({ matched_count: 1, remaining_count: 0 });
  expect(primaryFound.items).toHaveLength(1);
  expect(primaryFound.items[0]).toMatchObject({
    id: primaryId,
    title: primaryTitle,
    type: "project",
    scope: "project",
    status: "active",
    project_key: primaryProjectId,
    tags: ["e2e-primary"],
  });

  const primaryGet = await executeMemory(baseUrl, primarySessionId, {
    action: "get",
    id: primaryId,
    options: { max_chars: 6_000 },
  });
  expect(primaryGet.id).toBe(primaryId);
  const primaryDocument = requiredRecord(primaryGet.memory, "primary memory document");
  expect(primaryDocument).toMatchObject({
    body: primaryBody,
    body_truncated: false,
    retrieval_metadata_truncated: false,
  });
  const primaryFrontmatter = requiredRecord(
    primaryDocument.frontmatter,
    "primary frontmatter",
  );
  expect(primaryFrontmatter).toMatchObject({
    id: primaryId,
    title: primaryTitle,
    type: "project",
    scope: "project",
    status: "active",
    project_key: primaryProjectId,
    tags: ["e2e-primary"],
  });
  const primaryRetrieval = requiredRecord(
    primaryFrontmatter.retrieval,
    "primary retrieval metadata",
  );
  expect(primaryRetrieval.keywords).toEqual(expect.arrayContaining([primaryToken]));
  expect(primaryRetrieval.entities).toEqual(expect.arrayContaining(["Jiandu"]));

  const archived = await executeMemory(baseUrl, primarySessionId, {
    action: "purge",
    id: primaryId,
    mode: "archived",
  });
  expect(archived).toMatchObject({ id: primaryId, status: "archived" });
  const archivedGet = await executeMemory(baseUrl, primarySessionId, {
    action: "get",
    id: primaryId,
    options: { max_chars: 6_000 },
  });
  expect(
    requiredRecord(
      requiredRecord(archivedGet.memory, "archived memory document").frontmatter,
      "archived frontmatter",
    ).status,
  ).toBe("archived");
  const archivedInventory = await queryMemory(baseUrl, primarySessionId, "", 1);
  expect(archivedInventory.data).toMatchObject({
    returned_count: 1,
    matched_count: 1,
    remaining_count: 0,
    truncated: false,
  });
  expect(archivedInventory.items[0]).toMatchObject({
    id: primaryId,
    status: "archived",
  });

  const otherToken = `secondary${otherSessionId.replaceAll("-", "")}`;
  const otherWrite = await executeMemory(baseUrl, otherSessionId, {
    action: "write",
    scope: "project",
    type: "reference",
    title: `Memory ${otherToken}`,
    content: `Only the secondary Project can read ${otherToken}.`,
    tags: ["e2e-secondary"],
    keywords: [otherToken],
    entities: [],
    options: { allow_merge_if_similar: false },
  });
  const otherReceipt = requiredRecord(otherWrite.memory, "other write receipt");
  expect(otherReceipt).toMatchObject({
    scope: "project",
    status: "active",
    project_key: otherProjectId,
  });
  const otherId = otherReceipt.id;
  expect(typeof otherId).toBe("string");

  const primaryOwn = await queryMemory(baseUrl, primarySessionId, primaryToken);
  const primaryForeign = await queryMemory(baseUrl, primarySessionId, otherToken);
  const otherOwn = await queryMemory(baseUrl, otherSessionId, otherToken);
  const otherForeign = await queryMemory(baseUrl, otherSessionId, primaryToken);
  expect(primaryOwn.items.map((item) => item.id)).toEqual([primaryId]);
  expect(otherOwn.items.map((item) => item.id)).toEqual([otherId]);
  expect(primaryForeign.items).toEqual([]);
  expect(primaryForeign.data.matched_count).toBe(0);
  expect(otherForeign.items).toEqual([]);
  expect(otherForeign.data.matched_count).toBe(0);
});
