const chromiumNetworkChanged = "net::ERR_NETWORK_CHANGED";

const isChromiumNetworkChange = (error: unknown): error is Error =>
  error instanceof Error && error.message.includes(chromiumNetworkChanged);

const isChromiumErrorPageInterruption = (error: unknown): error is Error =>
  error instanceof Error &&
  /^page\.goto: Navigation to "https:\/\/[^"]+" is interrupted by another navigation to "chrome-error:\/\/chromewebdata\/"$/u.test(
    error.message.split("\n", 1)[0],
  );

/**
 * Chromium can invalidate its first navigation when a host-resolver rule becomes
 * active. A retry on that same throwaway page can then race Chromium's error
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
