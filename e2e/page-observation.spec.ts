import { EventEmitter } from "node:events";
import { expect, test, type Page, type Request, type Response } from "@playwright/test";
import { observePage } from "./support/pageObservation.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function request(pathname: string): Request {
  return {
    headers: () => ({}), method: () => "GET", resourceType: () => "fetch",
    url: () => `http://localhost${pathname}`, failure: () => ({ errorText: "failed transport" }),
  } as unknown as Request;
}
function response(owner: Request, body: () => Promise<unknown>, status = 200): Response {
  return { request: () => owner, url: () => owner.url(), json: body,
    status: () => status, ok: () => status >= 200 && status < 300 } as unknown as Response;
}
function harness(label = "first document") {
  const events = new EventEmitter();
  const page = events as unknown as Page;
  return { events, page, observation: observePage(page, label) };
}
const nextMicrotask = () => Promise.resolve();

test("retiring an observer waits for delayed body reads before navigation", async () => {
  const { events, observation } = harness();
  const body = deferred<unknown>();
  const owner = request("/api/v1/history/session");
  events.emit("request", owner);
  events.emit("response", response(owner, () => body.promise));
  events.emit("requestfinished", owner);
  let navigated = false;
  const navigation = (async () => {
    await observation.stop();
    // Browser navigation invalidates old response bodies; this must run last.
    navigated = true;
    body.reject(new Error("Response body unavailable after navigation"));
  })();
  await nextMicrotask();
  expect(navigated).toBe(false);
  expect(events.listenerCount("response")).toBe(1);
  body.resolve({ messages: ["persisted"] });
  await navigation;
  expect(navigated).toBe(true);
  expect(observation.historyDocuments).toEqual([{ messages: ["persisted"] }]);
  expect(observation.pageErrors).toEqual([]);
});

for (const [pathname, description] of [
  ["/api/v1/bootstrap", "bootstrap"],
  ["/api/v1/bamboo/settings/provider-instances", "provider-instances"],
  ["/api/v1/history/session", "history"],
] as const) {
  test(`retains ${description} body rejection while draining a retired observer`, async () => {
    const { events, observation } = harness();
    const body = deferred<unknown>();
    const owner = request(pathname);
    events.emit("request", owner);
    events.emit("response", response(owner, () => body.promise));
    events.emit("requestfinished", owner);
    const stopping = observation.stop();
    body.reject(new Error("invalid response body"));
    await stopping;
    expect(observation.pageErrors).toEqual([
      `Could not inspect the Bamboo ${description} response: Error: invalid response body`,
    ]);
  });
}

test("replacement excludes old requests and detaches only its own page and socket listeners", async () => {
  const { events, page, observation } = harness();
  const externalListener = () => {};
  events.on("request", externalListener);
  const socket = Object.assign(new EventEmitter(), { url: () => "ws://localhost/v2/stream" });
  socket.on("framereceived", externalListener);
  events.emit("websocket", socket);
  const oldRequest = request("/api/v1/history/old");
  await observation.stop();
  await observation.stop(); // Retirement is idempotent.
  expect(events.listeners("request")).toEqual([externalListener]);
  for (const event of ["response", "requestfailed", "requestfinished", "pageerror", "console", "websocket"]) {
    expect(events.listenerCount(event)).toBe(0);
  }
  expect(socket.listeners("framereceived")).toEqual([externalListener]);
  expect(socket.listenerCount("framesent")).toBe(0);
  expect(socket.listenerCount("socketerror")).toBe(0);
  // A request from the old document starts before the replacement attaches.
  events.emit("request", oldRequest);
  const replacement = observePage(page, "next document");
  let oldBodyRead = false;
  events.emit("response", response(oldRequest, async () => { oldBodyRead = true; return {}; }));
  events.emit("requestfailed", oldRequest);
  socket.emit("framereceived", { payload: '{"type":"old-frame"}' });
  const bootstrap = request("/api/v1/bootstrap");
  events.emit("request", bootstrap);
  events.emit("response", response(bootstrap, async () => ({ schema_version: 1 })));
  events.emit("requestfinished", bootstrap);
  await replacement.drain();
  expect(oldBodyRead).toBe(false);
  expect(replacement.bootstrapDocuments).toEqual([{ schema_version: 1 }]);
  expect(replacement.responses).toHaveLength(1);
  expect(replacement.failedRequests).toEqual([]);
  expect(observation.responses).toEqual([]);
  expect(observation.webSockets[0].received).toEqual([]);
  expect(events.listenerCount("response")).toBe(1);
  await replacement.stop();
  expect(events.listeners("request")).toEqual([externalListener]);
});

test("draining includes a response that arrives while an earlier body is pending", async () => {
  const { events, observation } = harness();
  const firstBody = deferred<unknown>();
  const secondBody = deferred<unknown>();
  const first = request("/api/v1/bootstrap");
  events.emit("request", first);
  events.emit("response", response(first, () => firstBody.promise));
  events.emit("requestfinished", first);
  let drained = false;
  const draining = observation.drain().then(() => { drained = true; });
  const second = request("/api/v1/history/session");
  events.emit("request", second);
  events.emit("response", response(second, () => secondBody.promise));
  events.emit("requestfinished", second);
  firstBody.resolve({ schema_version: 1 });
  for (let turn = 0; turn < 8; turn += 1) await nextMicrotask();
  expect(drained).toBe(false);
  secondBody.resolve({ messages: [] });
  await draining;
  expect(observation.historyDocuments).toEqual([{ messages: [] }]);
  await observation.stop();
});

test("owned HTTP, request, console, page, and socket failures remain observable", async () => {
  const { events, observation } = harness();
  const owner = request("/api/v1/history/failure");
  events.emit("request", owner);
  events.emit("response", response(owner, async () => ({}), 500));
  events.emit("requestfailed", owner);
  events.emit("console", { type: () => "error", text: () => "console failure" });
  events.emit("pageerror", new Error("page failure"));
  const socket = Object.assign(new EventEmitter(), { url: () => "ws://localhost/v2/stream" });
  events.emit("websocket", socket);
  socket.emit("socketerror", "socket failure");
  socket.emit("framereceived", { payload: "invalid json" });
  await observation.stop();
  expect(observation.responses[0].status).toBe(500);
  expect(observation.failedRequests).toEqual(["GET http://localhost/api/v1/history/failure failed transport"]);
  expect(observation.consoleErrors).toEqual(["console failure"]);
  expect(observation.pageErrors).toEqual(["page failure"]);
  expect(observation.webSockets[0].errors).toEqual(["socket failure"]);
  expect(observation.webSockets[0].received[0].malformed).toBe(true);
});


test("retirement records late owned HTTP failures and new requests arriving during drain", async () => {
  const { events, observation } = harness();
  const first = request("/api/v1/history/first");
  events.emit("request", first);
  let stopped = false;
  const stopping = observation.stop().then(() => { stopped = true; });
  await nextMicrotask();
  expect(stopped).toBe(false);
  const second = request("/api/v1/history/second");
  events.emit("request", second);
  events.emit("response", response(first, async () => ({}), 500));
  events.emit("requestfinished", first);
  await nextMicrotask();
  expect(stopped).toBe(false);
  const body = deferred<unknown>();
  events.emit("response", response(second, () => body.promise));
  events.emit("requestfinished", second);
  await nextMicrotask();
  expect(stopped).toBe(false);
  body.resolve({ messages: ["late but owned"] });
  await stopping;
  expect(observation.responses.map((item) => item.status)).toEqual([500, 200]);
  expect(observation.historyDocuments).toEqual([{ messages: ["late but owned"] }]);
  expect(events.listenerCount("response")).toBe(0);
});

test("real browser reload waits for delayed bootstrap inspection and starts a fresh response observation", async ({ page }) => {
  const { installArtifactRuntime, standaloneScenario } = await import("./support/artifactRuntime.js");
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"));
  await installArtifactRuntime(page, standaloneScenario);
  const readGate = deferred<void>();
  let delayed = false;
  const delayBootstrapRead = (result: Response) => {
    if (!delayed && new URL(result.url()).pathname === "/api/v1/bootstrap") {
      delayed = true;
      const readBody = result.json.bind(result);
      result.json = async () => { await readGate.promise; return readBody(); };
    }
  };
  page.on("response", delayBootstrapRead);
  const first = observePage(page, "before reload");
  let second: ReturnType<typeof observePage> | undefined;
  try {
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(delayed).toBe(true);
    expect(first.bootstrapDocuments).toEqual([]);
    let navigated = false;
    let firstResponseCount = 0;
    const navigation = (async () => {
      await first.stop();
      expect(first.pageErrors).toEqual([]);
      expect(first.bootstrapDocuments).toHaveLength(1);
      firstResponseCount = first.responses.length;
      second = observePage(page, "after reload");
      navigated = true;
      await page.reload({ waitUntil: "domcontentloaded" });
    })();
    await nextMicrotask();
    expect(navigated).toBe(false);
    readGate.resolve();
    await navigation;
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await second!.stop();
    expect(second!.bootstrapDocuments).toHaveLength(1);
    expect(first.bootstrapDocuments).toHaveLength(1);
    expect(first.responses).toHaveLength(firstResponseCount);
    expect(second!.historyDocuments.length).toBeGreaterThan(0);
    expect(first.pageErrors).toEqual([]);
    expect(second!.pageErrors).toEqual([]);
  } finally {
    readGate.resolve();
    await first.stop();
    await second?.stop();
    page.off("response", delayBootstrapRead);
  }
});
