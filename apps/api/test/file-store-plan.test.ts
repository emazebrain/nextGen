/** Where uploads are kept, and whether they outlive a deploy. */
import { describe, expect, it } from "vitest";
import { fileStorePlan } from "../src/files.ts";

describe("fileStorePlan", () => {
  it("uses an explicit folder when one is set", () => {
    expect(fileStorePlan({ FILE_STORE_DIR: "/srv/files", RAILWAY_VOLUME_MOUNT_PATH: "/data", NODE_ENV: "production" })).toEqual({ dir: "/srv/files", durable: true });
  });
  it("uses an attached Railway volume with no further setup", () => {
    expect(fileStorePlan({ RAILWAY_VOLUME_MOUNT_PATH: "/data", NODE_ENV: "production" })).toEqual({ dir: "/data/files", durable: true });
  });
  it("falls back to the container's own disk, and says a deploy will lose it", () => {
    expect(fileStorePlan({ NODE_ENV: "production" })).toEqual({ dir: ".data/files", durable: false });
    expect(fileStorePlan({})).toEqual({ dir: ".data/files", durable: true }); // development: nothing is deployed
  });
});
