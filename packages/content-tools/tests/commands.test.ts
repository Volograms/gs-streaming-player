import { describe, expect, it } from "vitest";

import { isContentToolCommand } from "../src/index.js";

describe("isContentToolCommand", () => {
  it("recognises planned commands", () => {
    expect(isContentToolCommand("validate-sequence")).toBe(true);
  });

  it("rejects unknown commands", () => {
    expect(isContentToolCommand("transcode-video")).toBe(false);
  });
});
