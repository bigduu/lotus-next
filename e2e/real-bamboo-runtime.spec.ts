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
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  const body = (await response.json()) as unknown;
  return { status: response.status, body };
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
