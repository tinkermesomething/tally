import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/db";
import { setGocardlessCredentials } from "@/lib/db/gocardless-credentials";
import { listInstitutions } from "@/lib/gocardless";

// Each test uses its own secretId so getAccessToken's in-memory token cache
// always misses and the token endpoint actually gets re-fetched.
beforeEach(() => resetDb());

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("GoCardless client - retry on a stale connection", () => {
  it("retries once on a bare 'fetch failed' and succeeds on the fresh connection", async () => {
    await setGocardlessCredentials("secret-id-1", "secret-key");
    const fetchMock = vi
      .fn()
      // 1st call: the token request, on a dead pooled connection.
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      // 2nd call: the token request retried on a fresh connection.
      .mockResolvedValueOnce(jsonResponse({ access: "tok", access_expires: 86400 }))
      // 3rd call: the actual institutions request.
      .mockResolvedValueOnce(jsonResponse([{ id: "SANDBOXFINANCE_SFIN0000" }]));
    vi.stubGlobal("fetch", fetchMock);

    const institutions = await listInstitutions("GB");

    expect(institutions).toEqual([{ id: "SANDBOXFINANCE_SFIN0000" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a real, non-connection error", async () => {
    await setGocardlessCredentials("secret-id-2", "secret-key");
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listInstitutions("GB")).rejects.toThrow("boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still throws if the retry itself also fails", async () => {
    await setGocardlessCredentials("secret-id-3", "secret-key");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listInstitutions("GB")).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
