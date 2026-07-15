import { describe, expect, it } from "vitest";

import { ClientThroughputEstimator } from "../src/index.js";

describe("ClientThroughputEstimator", () => {
  it("uses short and long windows conservatively and reports confidence", () => {
    const estimator = new ClientThroughputEstimator({
      longWindowSize: 4,
      shortWindowSize: 2,
    });
    estimator.observe(1_000_000, 100, 100);
    estimator.observe(1_000_000, 100, 200);
    estimator.observe(1_000_000, 200, 300);
    estimator.observe(1_000_000, 200, 400);

    expect(estimator.getState(500)).toMatchObject({
      confidence: expect.any(Number),
      estimatedThroughputBps: 40_000_000,
      source: "client-measured",
      timestampMs: 500,
    });
  });

  it("ignores invalid samples", () => {
    const estimator = new ClientThroughputEstimator();
    estimator.observe(0, 10, 0);
    estimator.observe(1_000, 0, 0);
    expect(estimator.getState(10)).toBeUndefined();
  });
});
