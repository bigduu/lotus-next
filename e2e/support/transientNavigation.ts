const chromiumNetworkChanged = "net::ERR_NETWORK_CHANGED";

const isChromiumNetworkChange = (error: unknown): error is Error =>
  error instanceof Error && error.message.includes(chromiumNetworkChanged);

/**
 * Chromium can invalidate its first navigation when a host-resolver rule becomes
 * active. Retry that one startup transition once; every other failure, and a
 * repeated transition, remains visible to the acceptance suite.
 */
export const navigateWithNetworkChangeRecovery = async <Result>(
  navigate: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await navigate();
  } catch (error) {
    if (!isChromiumNetworkChange(error)) throw error;
  }

  return navigate();
};
