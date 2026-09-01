/**
 * Stable, non-sensitive failures exposed by the HTTP API boundary.
 */

export type RequestErrorKind = "http" | "network" | "timeout" | "cancelled";

export class ApiError extends Error {
  readonly kind = "http" as const;

  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkRequestError extends Error {
  readonly kind = "network" as const;

  constructor(cause?: unknown) {
    super("A network error prevented the request. Check your connection and try again.", {
      cause,
    });
    this.name = "NetworkRequestError";
  }
}

export class RequestTimeoutError extends Error {
  readonly kind = "timeout" as const;

  constructor(cause?: unknown) {
    super("The request timed out. Please try again.", { cause });
    this.name = "RequestTimeoutError";
  }
}

export class RequestCancelledError extends Error {
  readonly kind = "cancelled" as const;

  constructor(cause?: unknown) {
    super("The request was cancelled.", { cause });
    this.name = "RequestCancelledError";
  }
}

export type RequestError =
  | ApiError
  | NetworkRequestError
  | RequestTimeoutError
  | RequestCancelledError;

/** Check specifically for an HTTP response failure. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Check for every typed failure emitted by the HTTP request boundary. */
export function isRequestError(error: unknown): error is RequestError {
  return (
    error instanceof ApiError ||
    error instanceof NetworkRequestError ||
    error instanceof RequestTimeoutError ||
    error instanceof RequestCancelledError
  );
}

/** Get a stable, user-facing message without exposing request details. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof RequestTimeoutError) {
    return "The request timed out. Please try again.";
  }
  if (error instanceof RequestCancelledError) {
    return "The request was cancelled.";
  }
  if (error instanceof NetworkRequestError) {
    return "A network error prevented the request. Check your connection and try again.";
  }
  if (isApiError(error)) {
    if (error.status === 401) {
      return "Authentication failed. Please check your credentials.";
    }
    if (error.status === 403) {
      return "You don't have permission to perform this action.";
    }
    if (error.status === 404) {
      return "The requested resource was not found.";
    }
    if (error.status >= 500) {
      return error.message?.trim() ? error.message : "Server error. Please try again later.";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred";
}

/** Handle an HTTP response failure with a fallback value. */
export async function withFallback<T>(
  promise: Promise<T>,
  fallback: T,
  onError?: (error: ApiError) => void,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isApiError(error) && onError) {
      onError(error);
    }
    return fallback;
  }
}
