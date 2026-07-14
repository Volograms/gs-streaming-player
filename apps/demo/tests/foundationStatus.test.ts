import { describe, expect, it } from "vitest";

import { getFoundationStatus } from "../src/foundationStatus.js";

describe("getFoundationStatus", () => {
  it("distinguishes completed foundation work from planned integrations", () => {
    const status = getFoundationStatus();

    expect(status.some((item) => item.status === "ready")).toBe(true);
    expect(status.some((item) => item.status === "planned")).toBe(true);
  });
});
