import type { Browser } from "@playwright/test";

const chromiumNetworkChanged = "net::ERR_NETWORK_CHANGED";

const isChromiumNetworkChange = (error: unknown): error is Error =>
  error instanceof Error && error.message.includes(chromiumNetworkChanged);

const isChromiumErrorPageInterruption = (error: unknown): error is Error =>
  error instanceof Error &&
  /^page\.goto: Navigation to "https?:\/\/[^"]+" is interrupted by another navigation to "chrome-error:\/\/chromewebdata\/"$/u.test(
    error.message.split("\n", 1)[0],
  );

/**
 * Chromium can invalidate its first navigation during a network transition.
 * A retry on that same throwaway page can then race Chromium's error
 * document. Only for that exact sequence, replace the page and make one final
 * attempt. All other failures remain visible to the acceptance suite.
 */
export const navigateWithNetworkChangeRecovery = async <Result>(
  navigate: () => Promise<Result>,
  resetErrorPage?: () => Promise<void>,
): Promise<Result> => {
  try {
    return await navigate();
  } catch (error) {
    if (!isChromiumNetworkChange(error)) throw error;
  }

  try {
    return await navigate();
  } catch (error) {
    if (!resetErrorPage || !isChromiumErrorPageInterruption(error)) throw error;
  }

  await resetErrorPage();
  return navigate();
};

export const preflightArtifactSurface = async (
  browser: Browser,
  entryUrl: URL,
): Promise<void> => {
  // A fresh Chromium can report a network transition after the first document
  // commits, abandoning its early lazy imports without terminal request events.
  // Settle the transport on readiness only: never load/cache the app or its
  // assets here. The subsequent app document retains every original gate.
  const readinessUrl = new URL("/readyz", entryUrl);
  const context = await browser.newContext({
    ignoreHTTPSErrors: entryUrl.protocol === "https:",
  });
  try {
    let page = await context.newPage();
    const response = await navigateWithNetworkChangeRecovery(
      () => page.goto(readinessUrl.href, { waitUntil: "networkidle" }),
      async () => {
        await page.close();
        page = await context.newPage();
      },
    );
    if (!response || response.url() !== readinessUrl.href || response.status() !== 200)
      throw new Error("Artifact preflight requires the exact successful readiness document");
    const readiness: unknown = await response.json();
    if (readiness === null || typeof readiness !== "object"
        || !("status" in readiness) || readiness.status !== "ok"
        || !("version" in readiness) || typeof readiness.version !== "string"
        || readiness.version.length === 0)
      throw new Error("Artifact preflight requires Bamboo readiness status and version");
  } finally {
    await context.close();
  }
};
