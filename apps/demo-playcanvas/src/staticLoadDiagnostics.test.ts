import { describe, expect, it } from "vitest";

import { readStaticLoadDiagnostics } from "./staticLoadDiagnostics.js";

describe("readStaticLoadDiagnostics", () => {
  it("separates static network delivery from native processing", () => {
    expect(
      readStaticLoadDiagnostics({
        completedAtMs: 350,
        entries: [
          {
            connectEnd: 5,
            connectStart: 5,
            duration: 250,
            encodedBodySize: 30_000_000,
            name: "/scene.sog",
            nextHopProtocol: "h2",
            responseEnd: 250,
            responseStart: 10,
            startTime: 0,
            transferSize: 30_000_500,
          },
        ],
        loadedBytes: 30_000_000,
        startedAtMs: 0,
        url: "/scene.sog",
      }),
    ).toMatchObject({
      bodyReadMs: 240,
      bodyThroughputMbps: 1_000,
      cacheStatus: "network",
      connectionReused: true,
      connectionSetupMs: 0,
      endToEndThroughputMbps: (30_000_000 * 0.008) / 350,
      loadedBytes: 30_000_000,
      nativeProcessingMs: 100,
      networkProtocol: "h2",
      networkTimeMs: 250,
      responseLatencyMs: 10,
      totalLoadMs: 350,
      transferredBytes: 30_000_500,
    });
  });
});
