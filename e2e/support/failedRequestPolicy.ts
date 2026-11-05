/**
 * Failed-request admission for the real-Bamboo page observations.
 *
 * `observePage` records every owned request failure verbatim, including a
 * deliberate cancellation: the `useTicketWork` polling effect aborts its
 * `AbortController` in the effect cleanup, so unmounting the panel or changing
 * the effect inputs cancels an in-flight `GET /api/v1/tickets/scope` read.
 * Chromium reports that cancellation as `net::ERR_ABORTED` even though no HTTP
 * exchange failed.
 *
 * The recorded failure text does not carry the abort reason, so this predicate
 * cannot tell an unmount cancellation apart from any other abort of that exact
 * read. It therefore admits only the one method/path/error/origin combination
 * the application aborts on purpose, mirroring the narrow
 * `expectedBrowserReadCancellation` predicate in
 * `real-bamboo-published-surfaces.spec.ts`. Every other failure - a different
 * path, a different method, a different transport error or a different origin -
 * stays a failure.
 */
export const expectedTicketScopeCancellation = (
  failure: string,
  pageOrigin: string,
): boolean =>
  failure === `GET ${pageOrigin}/api/v1/tickets/scope net::ERR_ABORTED`;

/**
 * The failures that still have to fail the page contract. Only the deliberate
 * ticket-scope cancellation is removed; the observation itself keeps recording
 * every failure for diagnostics.
 */
export const unexpectedFailedRequests = (
  failures: readonly string[],
  pageOrigin: string,
): string[] =>
  failures.filter(
    (failure) => !expectedTicketScopeCancellation(failure, pageOrigin),
  );
