export interface StaticLoadDiagnostics {
  bodyReadMs?: number;
  bodyThroughputMbps?: number;
  cacheStatus: "cache" | "network" | "timing unavailable";
  connectionReused?: boolean;
  connectionSetupMs?: number;
  endToEndThroughputMbps?: number;
  loadedBytes?: number;
  nativeProcessingMs?: number;
  networkProtocol?: string;
  networkTimeMs?: number;
  responseLatencyMs?: number;
  totalLoadMs: number;
  transferredBytes?: number;
}

interface ResourceTimingLike {
  connectEnd: number;
  connectStart: number;
  duration: number;
  encodedBodySize: number;
  name: string;
  nextHopProtocol: string;
  responseEnd: number;
  responseStart: number;
  startTime: number;
  transferSize: number;
}

interface StaticLoadDiagnosticOptions {
  completedAtMs: number;
  entries?: readonly ResourceTimingLike[];
  loadedBytes?: number;
  startedAtMs: number;
  url: string;
}

export function readStaticLoadDiagnostics({
  completedAtMs,
  entries,
  loadedBytes,
  startedAtMs,
  url,
}: StaticLoadDiagnosticOptions): StaticLoadDiagnostics {
  const totalLoadMs = Math.max(0, completedAtMs - startedAtMs);
  const absoluteUrl =
    typeof location === "undefined" ? url : new URL(url, location.href).toString();
  const resourceEntries =
    entries ??
    (typeof performance === "undefined"
      ? []
      : (performance.getEntriesByName(
          absoluteUrl,
          "resource",
        ) as PerformanceResourceTiming[]));
  const timing = [...resourceEntries]
    .reverse()
    .find(({ name }) => name === absoluteUrl || name === url);
  if (timing === undefined) {
    return {
      cacheStatus: "timing unavailable",
      ...(loadedBytes === undefined ? {} : { loadedBytes }),
      ...(loadedBytes === undefined || totalLoadMs <= 0
        ? {}
        : { endToEndThroughputMbps: (loadedBytes * 0.008) / totalLoadMs }),
      totalLoadMs,
    };
  }

  const bodyReadMs = Math.max(0, timing.responseEnd - timing.responseStart);
  const connectionSetupMs = Math.max(0, timing.connectEnd - timing.connectStart);
  const payloadBytes =
    loadedBytes ?? (timing.encodedBodySize > 0 ? timing.encodedBodySize : undefined);
  const networkTimeMs = Math.max(0, timing.duration);
  const networkProtocol = timing.nextHopProtocol.trim();
  return {
    bodyReadMs,
    ...(payloadBytes === undefined || bodyReadMs <= 0
      ? {}
      : { bodyThroughputMbps: (payloadBytes * 0.008) / bodyReadMs }),
    cacheStatus:
      timing.transferSize === 0 && timing.encodedBodySize > 0 ? "cache" : "network",
    connectionReused: connectionSetupMs === 0,
    connectionSetupMs,
    ...(payloadBytes === undefined || totalLoadMs <= 0
      ? {}
      : { endToEndThroughputMbps: (payloadBytes * 0.008) / totalLoadMs }),
    ...(payloadBytes === undefined ? {} : { loadedBytes: payloadBytes }),
    nativeProcessingMs: Math.max(0, totalLoadMs - networkTimeMs),
    ...(networkProtocol.length === 0 ? {} : { networkProtocol }),
    networkTimeMs,
    responseLatencyMs: Math.max(0, timing.responseStart - timing.startTime),
    totalLoadMs,
    ...(timing.transferSize <= 0 ? {} : { transferredBytes: timing.transferSize }),
  };
}
