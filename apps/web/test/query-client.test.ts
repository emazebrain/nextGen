/** Offline, queries must still run (and fail fast) so the device can answer them (offline devices spec §7.3). */
import { describe, expect, it } from "vitest";
import { makeQueryClient } from "../src/App.tsx";

describe("query client", () => {
  it("never pauses requests while the browser reports offline", () => {
    const qc = makeQueryClient();
    expect(qc.getDefaultOptions().queries?.networkMode).toBe("always");
    expect(qc.getDefaultOptions().mutations?.networkMode).toBe("always");
  });
});

describe("signed-in check while offline", () => {
  it("asks /v1/me again every 15 seconds while the network is down", async () => {
    const { ME_RETRY_OFFLINE_MS } = await import("../src/api/queries.ts");
    expect(ME_RETRY_OFFLINE_MS).toBe(15_000);
  });
});
