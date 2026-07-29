import { describe, expect, it } from "vitest";

import { isContentToolCommand } from "../src/index.js";

describe("isContentToolCommand", () => {
  it("recognises planned commands", () => {
    expect(isContentToolCommand("build")).toBe(true);
    expect(isContentToolCommand("validate-sequence")).toBe(true);
    expect(isContentToolCommand("extract-rad-cuts")).toBe(true);
    expect(isContentToolCommand("convert-sog")).toBe(true);
    expect(isContentToolCommand("export-sog-lod")).toBe(true);
    expect(isContentToolCommand("repack-spz-v4")).toBe(true);
  });

  it("rejects unknown commands", () => {
    expect(isContentToolCommand("transcode-video")).toBe(false);
  });
});
