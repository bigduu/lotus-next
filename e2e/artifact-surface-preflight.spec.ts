import { expect, test, type Browser } from "@playwright/test";
import { preflightArtifactSurface } from "./support/transientNavigation.ts";
import { observePage } from "./support/pageObservation.ts";

test("readiness preflight leaves the first app document and its failures fully observed", async ({ browser }) => {
  const origin = "http://artifact-preflight.test";
  const probes: string[] = [];
  const preflightBrowser = {
    newContext: async (options) => {
      const context = await browser.newContext(options);
      await context.route(`${origin}/**`, async (route) => {
        probes.push(route.request().url());
        await route.fulfill({ json: { status: "ok", version: "fixture" } });
      });
      return context;
    },
  } as Browser;
  await preflightArtifactSurface(preflightBrowser, new URL(origin));
  expect(probes).toEqual([origin + "/readyz"]);

  const context = await browser.newContext();
  await context.route(`${origin}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") {
      await route.fulfill({ contentType: "text/html", body:
        '<!doctype html><script src="/app.js"></script><p>observed app</p>' });
    } else if (pathname === "/app.js") {
      await route.fulfill({ contentType: "text/javascript", body:
        'void fetch("/api/v1/bootstrap").then(r => r.json()).then(() => fetch("/owned-failure"))' });
    } else if (pathname === "/api/v1/bootstrap") {
      await route.fulfill({ json: { schema_version: 1 } });
    } else await route.fulfill({ status: 503, body: "owned failure" });
  });
  const page = await context.newPage();
  const observation = observePage(page, "first app document");
  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    await observation.stop();
    expect(observation.bootstrapDocuments).toEqual([{ schema_version: 1 }]);
    expect(observation.requests.filter(r => new URL(r.url).pathname === "/app.js")).toHaveLength(1);
    expect(observation.responses.filter(r => r.status === 503)).toEqual([
      { method: "GET", url: origin + "/owned-failure", status: 503 },
    ]);
    expect(observation.requests.some(r => new URL(r.url).pathname === "/readyz")).toBe(false);
    expect(observation.consoleErrors.length).toBeGreaterThan(0);
    expect(observation.failedRequests).toEqual([]);
  } finally {
    await observation.stop();
    await context.close();
  }
});
