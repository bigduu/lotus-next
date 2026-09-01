import { describe, expect, it } from "vitest";

import { getRuntimeConfig } from "../../runtime/runtimeConfig";
import { agentApiClient, apiClient } from ".";
import { ApiClient } from "./client";

describe("API runtime composition", () => {
  it("creates the standard and agent clients from the installed endpoint set", () => {
    const runtime = getRuntimeConfig();

    expect(apiClient.resolveUrl("models")).toBe(`${runtime.endpoints.standardApi}/models`);
    expect(agentApiClient.resolveUrl("sessions/session-1")).toBe(
      `${runtime.endpoints.agentApi}/sessions/session-1`,
    );
  });

  it("requires an explicit base URL for a generic client and joins paths once", () => {
    const client = new ApiClient({
      baseUrl: "https://api.example:9443/v1/",
      requestCredentials: "omit",
    });

    expect(client.resolveUrl("///workspace/validate")).toBe(
      "https://api.example:9443/v1/workspace/validate",
    );
  });
});
