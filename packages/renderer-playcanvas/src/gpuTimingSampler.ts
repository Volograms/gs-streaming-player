import type {
  PlayCanvasGpuPassTiming,
  PlayCanvasGpuTimingDistribution,
  PlayCanvasGpuTimingSnapshot,
} from "./types.js";
import type { Application, EventHandle } from "playcanvas";

interface GpuProfilerLike {
  enabled: boolean;
  readonly passTimings: ReadonlyMap<string, number>;
  report(renderVersion: unknown, timings: unknown, frameTime: unknown): void;
  readonly timestampQueriesSet?: unknown;
}

interface GraphicsDeviceWithGpuProfiler {
  readonly gpuProfiler?: GpuProfilerLike;
  readonly isWebGPU?: boolean;
  readonly supportsTimestampQuery?: boolean;
}

const CAPTURE_FRAME_COUNT = 2;
const DEFAULT_SAMPLE_LIMIT = 60;
const UNATTRIBUTED_PASS_NAME = "Unattributed / transfers";

export const DISABLED_GPU_TIMING_SNAPSHOT = createSnapshot(
  "disabled",
  0,
  0,
  [],
  undefined,
);

export class PlayCanvasGpuTimingSampler {
  private armHandle: EventHandle | undefined;
  private captureHandle: EventHandle | undefined;
  private capturedFrameCount = 0;
  private disposed = false;
  private readonly frameSamples: number[] = [];
  private nextSampleAt = 0;
  private readonly originalEnabled: boolean;
  private readonly originalReport: GpuProfilerLike["report"] | undefined;
  private readonly passFrames: ReadonlyMap<string, number>[] = [];
  private readonly profiler: GpuProfilerLike | undefined;
  private readonly reportWrapper: GpuProfilerLike["report"] | undefined;
  private snapshotValue: PlayCanvasGpuTimingSnapshot;

  constructor(
    private readonly application: Application,
    private readonly sampleIntervalMs: number,
    private readonly now: () => number,
    private readonly sampleLimit = DEFAULT_SAMPLE_LIMIT,
  ) {
    const device =
      application.graphicsDevice as unknown as GraphicsDeviceWithGpuProfiler;
    const profiler = device.gpuProfiler;
    this.originalEnabled = profiler?.enabled ?? false;

    if (sampleIntervalMs === 0) {
      this.snapshotValue = createSnapshot(
        "disabled",
        sampleIntervalMs,
        0,
        [],
        undefined,
      );
      return;
    }
    if (device.isWebGPU !== true) {
      this.snapshotValue = createSnapshot(
        "unsupported",
        sampleIntervalMs,
        0,
        [],
        undefined,
        "WebGPU is required for sampled pass timings.",
      );
      return;
    }
    if (
      device.supportsTimestampQuery !== true ||
      profiler === undefined ||
      profiler.timestampQueriesSet == null
    ) {
      this.snapshotValue = createSnapshot(
        "unsupported",
        sampleIntervalMs,
        0,
        [],
        undefined,
        "This device does not expose WebGPU timestamp-query support.",
      );
      return;
    }

    this.profiler = profiler;
    this.originalReport = profiler.report;
    this.reportWrapper = (
      renderVersion: unknown,
      timings: unknown,
      frameTime: unknown,
    ): void => {
      this.originalReport?.call(profiler, renderVersion, timings, frameTime);
      this.observeReport(timings, frameTime);
    };
    profiler.report = this.reportWrapper;
    this.snapshotValue = createSnapshot("waiting", sampleIntervalMs, 0, [], undefined);
  }

  getSnapshot(): PlayCanvasGpuTimingSnapshot {
    return this.snapshotValue;
  }

  requestSample(): void {
    if (
      this.disposed ||
      this.profiler === undefined ||
      this.originalEnabled ||
      this.armHandle !== undefined ||
      this.captureHandle !== undefined
    ) {
      return;
    }
    const requestedAt = this.now();
    if (requestedAt < this.nextSampleAt) {
      return;
    }
    this.nextSampleAt = requestedAt + this.sampleIntervalMs;
    this.profiler.enabled = true;
    this.armHandle = this.application.once("prerender", () => {
      this.armHandle = undefined;
      let remainingFrames = CAPTURE_FRAME_COUNT;
      this.captureHandle = this.application.on("frameend", () => {
        remainingFrames -= 1;
        if (remainingFrames > 0) {
          return;
        }
        this.captureHandle?.off();
        this.captureHandle = undefined;
        if (this.profiler !== undefined) {
          this.profiler.enabled = this.originalEnabled;
        }
      });
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.armHandle?.off();
    this.armHandle = undefined;
    this.captureHandle?.off();
    this.captureHandle = undefined;
    if (this.profiler !== undefined) {
      this.profiler.enabled = this.originalEnabled;
      if (
        this.profiler.report === this.reportWrapper &&
        this.originalReport !== undefined
      ) {
        this.profiler.report = this.originalReport;
      }
    }
  }

  private observeReport(timings: unknown, frameTime: unknown): void {
    if (this.disposed || !Array.isArray(timings) || timings.length === 0) {
      return;
    }
    const passEntries = [...(this.profiler?.passTimings ?? [])].filter(
      (entry): entry is [string, number] =>
        typeof entry[0] === "string" && Number.isFinite(entry[1]) && entry[1] >= 0,
    );
    const attributedTime = passEntries.reduce((sum, [, value]) => sum + value, 0);
    const measuredFrameTime =
      typeof frameTime === "number" && Number.isFinite(frameTime) && frameTime >= 0
        ? frameTime
        : attributedTime;
    if (measuredFrameTime <= 0) {
      return;
    }

    pushBounded(this.frameSamples, measuredFrameTime, this.sampleLimit);
    const passFrame = new Map<string, number>();
    for (const [name, value] of passEntries) {
      passFrame.set(name, value);
    }
    const unattributedTime = measuredFrameTime - attributedTime;
    if (unattributedTime > 0.001) {
      passFrame.set(UNATTRIBUTED_PASS_NAME, unattributedTime);
    }
    pushBounded(this.passFrames, passFrame, this.sampleLimit);
    this.capturedFrameCount += 1;
    this.refreshSnapshot();
  }

  private refreshSnapshot(): void {
    const passSamples = new Map<string, number[]>();
    for (const passFrame of this.passFrames) {
      for (const [name, value] of passFrame) {
        const samples = passSamples.get(name) ?? [];
        samples.push(value);
        passSamples.set(name, samples);
      }
    }
    const passTimings = [...passSamples].map(([name, samples]) => ({
      name,
      ...distribution(samples),
    }));
    passTimings.sort(comparePassTimings);
    this.snapshotValue = createSnapshot(
      "ready",
      this.sampleIntervalMs,
      this.capturedFrameCount,
      passTimings,
      distribution(this.frameSamples),
    );
  }
}

function comparePassTimings(
  left: PlayCanvasGpuPassTiming,
  right: PlayCanvasGpuPassTiming,
): number {
  return right.p95Ms - left.p95Ms || left.name.localeCompare(right.name);
}

function createSnapshot(
  status: PlayCanvasGpuTimingSnapshot["status"],
  sampleIntervalMs: number,
  capturedFrameCount: number,
  passTimings: readonly PlayCanvasGpuPassTiming[],
  frameTime: PlayCanvasGpuTimingDistribution | undefined,
  reason?: string,
): PlayCanvasGpuTimingSnapshot {
  return {
    captureFrameCount: CAPTURE_FRAME_COUNT,
    capturedFrameCount,
    ...(frameTime === undefined ? {} : { frameTime }),
    passTimings,
    ...(reason === undefined ? {} : { reason }),
    sampleIntervalMs,
    status,
  };
}

function distribution(samples: readonly number[]): PlayCanvasGpuTimingDistribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    latestMs: samples.at(-1) ?? 0,
    maxMs: sorted.at(-1) ?? 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    sampleCount: samples.length,
  };
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * percentileValue) - 1,
  );
  return sorted[index] ?? 0;
}

function pushBounded<T>(samples: T[], value: T, limit: number): void {
  samples.push(value);
  if (samples.length > limit) {
    samples.splice(0, samples.length - limit);
  }
}
