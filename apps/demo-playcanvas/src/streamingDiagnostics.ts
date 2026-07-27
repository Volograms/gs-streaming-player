import type {
  FrameRingBufferTraceEvent,
  PlayerLifecycleState,
} from "@6g-path/gaussian-player";

const maximumSamples = 120;

export interface DiagnosticDistribution {
  count: number;
  p50?: number;
  p95?: number;
}

export interface StreamingDiagnosticsSnapshot {
  aggregateFetchMbps?: number;
  basePreparation: DiagnosticDistribution;
  bodyRead: DiagnosticDistribution;
  cacheHitCount: number;
  completedFetchCount: number;
  connectionSetup: DiagnosticDistribution;
  configuredFetchConcurrency: number;
  configuredPreparationConcurrency: number;
  droppedFrameCount: number;
  eventLoopLag: DiagnosticDistribution;
  hardwareConcurrency?: number;
  longTaskCount: number;
  longTaskSupported: boolean;
  longTaskTimeMs: number;
  networkProtocol?: string;
  newConnectionCount: number;
  presentationFramesPerSecond?: number;
  preparationQueue: DiagnosticDistribution;
  requestMbps: DiagnosticDistribution;
  responseLatency: DiagnosticDistribution;
  sogAssetLoad: DiagnosticDistribution;
  stallCount: number;
  stallTimeMs: number;
  totalFetch: DiagnosticDistribution;
}

interface FetchSample {
  bodyReadMs: number;
  completedAtMs: number;
  durationMs: number;
  loadedBytes: number;
  responseLatencyMs: number;
}

interface PlaybackObservation {
  droppedFrameCount: number;
  lifecycle: PlayerLifecycleState;
}

/**
 * Bounded, low-frequency measurements for separating delivery, queueing, native SOG
 * loading, and main-thread pressure on constrained devices.
 */
export class StreamingDiagnostics {
  private readonly basePreparationMs: number[] = [];
  private cacheHitCount = 0;
  private completedFetchCount = 0;
  private readonly eventLoopLagMs: number[] = [];
  private eventLoopTimer: number | undefined;
  private readonly fetchSamples: FetchSample[] = [];
  private lastPlayback: PlaybackObservation | undefined;
  private longTaskCount = 0;
  private longTaskObserver: PerformanceObserver | undefined;
  private longTaskSupported = false;
  private longTaskTimeMs = 0;
  private readonly connectionSetupMs: number[] = [];
  private newConnectionCount = 0;
  private readonly networkProtocols = new Map<string, number>();
  private readonly now: () => number;
  private readonly presentationTimesMs: number[] = [];
  private readonly preparationQueueMs: number[] = [];
  private readonly sogAssetLoadMs: number[] = [];
  private stallCount = 0;
  private stallStartedAtMs: number | undefined;
  private stallTimeMs = 0;

  constructor(
    private readonly configuredFetchConcurrency: number,
    private readonly configuredPreparationConcurrency: number,
    now: () => number = () => performance.now(),
  ) {
    this.now = now;
  }

  start(): void {
    if (this.eventLoopTimer !== undefined) {
      return;
    }
    const intervalMs = 100;
    performance.setResourceTimingBufferSize?.(2_000);
    let expectedAt = this.now() + intervalMs;
    this.eventLoopTimer = window.setInterval(() => {
      const observedAt = this.now();
      pushBounded(this.eventLoopLagMs, Math.max(0, observedAt - expectedAt));
      expectedAt = observedAt + intervalMs;
    }, intervalMs);

    if (typeof PerformanceObserver !== "undefined") {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.longTaskCount += 1;
            this.longTaskTimeMs += entry.duration;
          }
        });
        this.longTaskObserver.observe({ entryTypes: ["longtask"] });
        this.longTaskSupported = true;
      } catch {
        this.longTaskObserver = undefined;
      }
    }
  }

  dispose(): void {
    if (this.eventLoopTimer !== undefined) {
      window.clearInterval(this.eventLoopTimer);
      this.eventLoopTimer = undefined;
    }
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = undefined;
  }

  reset(): void {
    performance.clearResourceTimings?.();
    this.basePreparationMs.length = 0;
    this.cacheHitCount = 0;
    this.completedFetchCount = 0;
    this.connectionSetupMs.length = 0;
    this.eventLoopLagMs.length = 0;
    this.fetchSamples.length = 0;
    this.lastPlayback = undefined;
    this.longTaskCount = 0;
    this.longTaskTimeMs = 0;
    this.networkProtocols.clear();
    this.newConnectionCount = 0;
    this.presentationTimesMs.length = 0;
    this.preparationQueueMs.length = 0;
    this.sogAssetLoadMs.length = 0;
    this.stallCount = 0;
    this.stallStartedAtMs = undefined;
    this.stallTimeMs = 0;
  }

  observeTrace(event: Readonly<FrameRingBufferTraceEvent>): void {
    if (
      event.type === "compressed-fetch-ready" &&
      event.durationMs !== undefined &&
      event.loadedBytes !== undefined
    ) {
      this.fetchSamples.push({
        bodyReadMs: event.bodyReadMs ?? event.durationMs,
        completedAtMs: event.atMs,
        durationMs: event.durationMs,
        loadedBytes: event.loadedBytes,
        responseLatencyMs: event.responseLatencyMs ?? 0,
      });
      this.completedFetchCount += 1;
      trimBounded(this.fetchSamples);
      if (event.connectionSetupMs !== undefined) {
        pushBounded(this.connectionSetupMs, event.connectionSetupMs);
      }
      if (event.connectionReused === false) {
        this.newConnectionCount += 1;
      }
      if (event.networkProtocol !== undefined) {
        this.networkProtocols.set(
          event.networkProtocol,
          (this.networkProtocols.get(event.networkProtocol) ?? 0) + 1,
        );
      }
    } else if (event.type === "compressed-cache-hit") {
      this.cacheHitCount += 1;
    } else if (event.type === "base-started" && event.durationMs !== undefined) {
      pushBounded(this.preparationQueueMs, event.durationMs);
    } else if (
      event.type === "renderer-phase" &&
      event.phase === "gpu-upload" &&
      event.stageDurationMs !== undefined
    ) {
      pushBounded(this.sogAssetLoadMs, event.stageDurationMs);
    } else if (event.type === "base-ready" && event.durationMs !== undefined) {
      pushBounded(this.basePreparationMs, event.durationMs);
    } else if (event.type === "presented") {
      pushBounded(this.presentationTimesMs, event.atMs);
    }
  }

  observePlayback(observation: PlaybackObservation): void {
    const observedAt = this.now();
    if (
      observation.lifecycle === "BUFFERING" &&
      this.lastPlayback?.lifecycle !== "BUFFERING"
    ) {
      this.stallCount += 1;
      this.stallStartedAtMs = observedAt;
    } else if (
      observation.lifecycle !== "BUFFERING" &&
      this.lastPlayback?.lifecycle === "BUFFERING" &&
      this.stallStartedAtMs !== undefined
    ) {
      this.stallTimeMs += observedAt - this.stallStartedAtMs;
      this.stallStartedAtMs = undefined;
    }
    this.lastPlayback = observation;
  }

  snapshot(): StreamingDiagnosticsSnapshot {
    const bodyReadMs = this.fetchSamples.map(({ bodyReadMs }) => bodyReadMs);
    const responseLatencyMs = this.fetchSamples.map(
      ({ responseLatencyMs }) => responseLatencyMs,
    );
    const totalFetchMs = this.fetchSamples.map(({ durationMs }) => durationMs);
    const requestMbps = this.fetchSamples
      .filter(({ bodyReadMs }) => bodyReadMs > 0)
      .map(({ bodyReadMs, loadedBytes }) => (loadedBytes * 0.008) / bodyReadMs);
    const aggregateStartedAtMs = this.fetchSamples.reduce(
      (earliest, { completedAtMs, durationMs }) =>
        Math.min(earliest, completedAtMs - durationMs),
      Number.POSITIVE_INFINITY,
    );
    const aggregateCompletedAtMs = this.fetchSamples.reduce(
      (latest, { completedAtMs }) => Math.max(latest, completedAtMs),
      Number.NEGATIVE_INFINITY,
    );
    const aggregateWindowMs = aggregateCompletedAtMs - aggregateStartedAtMs;
    const aggregateBytes = this.fetchSamples.reduce(
      (total, { loadedBytes }) => total + loadedBytes,
      0,
    );
    const firstPresentation = this.presentationTimesMs[0];
    const lastPresentation =
      this.presentationTimesMs[this.presentationTimesMs.length - 1];
    const presentationSpanMs =
      firstPresentation === undefined || lastPresentation === undefined
        ? undefined
        : lastPresentation - firstPresentation;
    const activeStallMs =
      this.stallStartedAtMs === undefined ? 0 : this.now() - this.stallStartedAtMs;
    const networkProtocol = [...this.networkProtocols.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([protocol, count]) => `${protocol} (${count})`)
      .join(", ");

    return {
      ...(!Number.isFinite(aggregateWindowMs) || aggregateWindowMs <= 0
        ? {}
        : { aggregateFetchMbps: (aggregateBytes * 0.008) / aggregateWindowMs }),
      basePreparation: distribution(this.basePreparationMs),
      bodyRead: distribution(bodyReadMs),
      cacheHitCount: this.cacheHitCount,
      completedFetchCount: this.completedFetchCount,
      connectionSetup: distribution(this.connectionSetupMs),
      configuredFetchConcurrency: this.configuredFetchConcurrency,
      configuredPreparationConcurrency: this.configuredPreparationConcurrency,
      droppedFrameCount: this.lastPlayback?.droppedFrameCount ?? 0,
      eventLoopLag: distribution(this.eventLoopLagMs),
      ...(typeof navigator === "undefined" ||
      navigator.hardwareConcurrency === undefined
        ? {}
        : { hardwareConcurrency: navigator.hardwareConcurrency }),
      longTaskCount: this.longTaskCount,
      longTaskSupported: this.longTaskSupported,
      longTaskTimeMs: this.longTaskTimeMs,
      ...(networkProtocol.length === 0 ? {} : { networkProtocol }),
      newConnectionCount: this.newConnectionCount,
      ...(presentationSpanMs === undefined || presentationSpanMs <= 0
        ? {}
        : {
            presentationFramesPerSecond:
              ((this.presentationTimesMs.length - 1) * 1_000) / presentationSpanMs,
          }),
      preparationQueue: distribution(this.preparationQueueMs),
      requestMbps: distribution(requestMbps),
      responseLatency: distribution(responseLatencyMs),
      sogAssetLoad: distribution(this.sogAssetLoadMs),
      stallCount: this.stallCount,
      stallTimeMs: this.stallTimeMs + activeStallMs,
      totalFetch: distribution(totalFetchMs),
    };
  }
}

function distribution(values: readonly number[]): DiagnosticDistribution {
  if (values.length === 0) {
    return { count: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!;
}

function pushBounded(values: number[], value: number): void {
  values.push(value);
  trimBounded(values);
}

function trimBounded(values: unknown[]): void {
  if (values.length > maximumSamples) {
    values.splice(0, values.length - maximumSamples);
  }
}
