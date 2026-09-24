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
    estimator.observe(1_000_000, 200, 400);
    estimator.observe(1_000_000, 200, 600);

    expect(estimator.getState(700)).toMatchObject({
      confidence: expect.any(Number),
      estimatedThroughputBps: 40_000_000,
      source: "client-measured",
      timestampMs: 700,
    });
  });

  it("measures six overlapping 1 MB transfers as 240 Mbps, not 40 Mbps", () => {
    const estimator = new ClientThroughputEstimator();
    for (let index = 0; index < 6; index += 1) estimator.observe(1_000_000, 200, 200);
    expect(estimator.getState(200)?.estimatedThroughputBps).toBe(240_000_000);
  });

  it("does not sum unrelated requests or count intentional idle gaps", () => {
    const estimator = new ClientThroughputEstimator();
    for (let index = 0; index < 6; index += 1)
      estimator.observe(1_000_000, 200, index * 1_000 + 200);
    expect(estimator.getState(5_200)?.estimatedThroughputBps).toBe(40_000_000);
  });

  it("ages old evidence and ignores future samples", () => {
    const estimator = new ClientThroughputEstimator({ maximumSampleAgeMs: 1_000 });
    estimator.observe(1_000_000, 200, 200);
    expect(estimator.getState(0)).toBeUndefined();
    expect(estimator.getState(1_000)!.confidence).toBeLessThan(
      estimator.getState(200)!.confidence!,
    );
    expect(estimator.getState(1_201)).toBeUndefined();
    estimator.observe(100_000, 200, 1_400);
    expect(estimator.getState(1_400)?.estimatedThroughputBps).toBe(4_000_000);
  });

  it("ignores invalid samples", () => {
    const estimator = new ClientThroughputEstimator();
    estimator.observe(0, 10, 0);
    estimator.observe(1_000, 0, 0);
    expect(estimator.getState(10)).toBeUndefined();
  });
});
