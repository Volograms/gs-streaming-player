import {
  bufferedTimeRanges,
  decodedTimeRanges,
} from "../buffering/bufferedTimeRanges.js";
import { FrameRingBuffer } from "../buffering/FrameRingBuffer.js";
import { loadManifest } from "../manifest/loader.js";
import { sequencePlaybackDurationSeconds } from "../manifest/timeline.js";
import { ClientThroughputEstimator } from "../network/ClientThroughputEstimator.js";
import { BufferAwareQualityController } from "../quality/BufferAwareQualityController.js";
import { sequenceQualityLevels } from "../quality/sequenceQualityLevels.js";

import { MediaPlaybackClock } from "./MediaPlaybackClock.js";
import { SequencePlaybackController } from "./SequencePlaybackController.js";

import type { PlayerLifecycleState, PlaybackState } from "./playbackState.js";
import type {
  PlaybackClock,
  SequencePlaybackSnapshot,
} from "./SequencePlaybackController.js";
import type { BufferedTimeRange } from "../buffering/bufferedTimeRanges.js";
import type {
  FrameRingBufferConfiguration,
  FrameRingBufferTraceEvent,
} from "../buffering/types.js";
import type { ManifestLoadOptions, ManifestSource } from "../manifest/loader.js";
import type {
  DynamicGaussianSequence,
  GaussianSequenceManifest,
  MediaTrack,
} from "../manifest/types.js";
import type { NetworkState } from "../network/types.js";
import type { PlayerMetrics, QualityController } from "../quality/types.js";
import type { GaussianRendererAdapter, RendererMetrics } from "../renderer/types.js";
import type { GaussianFrameDecoderRegistry } from "@6g-path/gaussian-codec";

const DEFAULT_COMPRESSED_BUFFER_BYTES = 200_000_000;
const DEFAULT_TARGET_BUFFER_SECONDS = 5;
const DEFAULT_DECODED_BUFFER_BYTES = 500_000_000;
const DEFAULT_MINIMUM_DETAIL = 0.25;

export interface GaussianStreamingMediaElement {
  crossOrigin: string | null;
  currentTime: number;
  duration: number;
  ended: boolean;
  muted: boolean;
  paused: boolean;
  preload: string;
  src: string;
  volume: number;
  readonly error?: { code: number; message?: string } | null;
  addEventListener(type: string, listener: () => void): void;
  load?(): void;
  pause(): void;
  play(): Promise<void>;
  removeAttribute?(name: string): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type GaussianStreamingMediaElementFactory = (
  track: Readonly<MediaTrack>,
) => GaussianStreamingMediaElement;

export type GaussianStreamingQualityMode =
  | { mode: "automatic" }
  | { detailLevel: number; minimumSplatCount?: number; mode: "manual" };

export interface GaussianStreamingPlayerBufferOptions extends FrameRingBufferConfiguration {
  minimumReadyFrames?: number;
  /** Decoded lookahead and automatic-quality reserve target; compressed prefetch fills its byte budget. */
  targetBufferSeconds?: number;
}

export interface GaussianStreamingPlayerOptions {
  audioElementFactory?: GaussianStreamingMediaElementFactory;
  baseUrl?: string | URL;
  buffer?: GaussianStreamingPlayerBufferOptions;
  clock?: PlaybackClock;
  decoderRegistry?: GaussianFrameDecoderRegistry;
  fetch?: typeof globalThis.fetch;
  loop?: boolean;
  manifest: ManifestSource;
  qualityController?: QualityController;
  renderer: GaussianRendererAdapter;
  sequenceId?: string;
  signal?: AbortSignal;
}

export interface GaussianStreamingPlayerSnapshot {
  audio: {
    configured: boolean;
    muted: boolean;
    volume: number;
  };
  bufferAheadFrames: number;
  /** Downloaded/prepared frame intervals; excludes in-flight downloads and gaps. */
  bufferedTimeRanges: readonly BufferedTimeRange[];
  /** Resident frames fully decoded/prepared and ready for presentation. */
  decodedTimeRanges: readonly BufferedTimeRange[];
  /** Total resident ready/presented frames, including the current frame. */
  decodedFrameCount: number;
  bufferDiagnostics?: Readonly<{
    downloadedAheadSeconds: number;
    decodedAheadSeconds: number;
    compressedResidentBytes: number;
    compressedCapacityBytes: number;
    decodedResidentBytes: number;
    decodedCapacityBytes: number;
    decodedTargetFrames: number;
  }>;
  currentFrameIndex: number;
  currentTimeSeconds: number;
  droppedFrameCount: number;
  durationSeconds: number;
  error?: unknown;
  isPlaying: boolean;
  lifecycle: PlayerLifecycleState;
  manifestId: string;
  qualityMode: GaussianStreamingQualityMode;
  /** Latest automatic-policy inputs and requested tier, distinct from rendered splat count. */
  qualityDiagnostics?: Readonly<{
    bufferAheadSeconds: number;
    compressedBufferAheadSeconds?: number;
    dynamicFrameDetailLevel: number;
    estimatedThroughputBps: number;
    networkConfidence: number;
    targetBufferSeconds: number;
    targetFramesPerSecond?: number;
  }>;
  renderer: RendererMetrics;
  sequenceId: string;
  presentationTiming?: SequencePlaybackSnapshot["presentationTiming"];
}

type SnapshotListener = (snapshot: Readonly<GaussianStreamingPlayerSnapshot>) => void;

/**
 * Preview high-level player facade. It composes the renderer-neutral manifest,
 * buffering, quality and playback primitives while leaving rendering to the
 * supplied adapter.
 */
export class GaussianStreamingPlayer {
  private readonly audioClock: MediaPlaybackClock | undefined;
  private audioError: unknown;
  private readonly buffer: FrameRingBuffer;
  private bufferedTimeRangesValue: readonly BufferedTimeRange[] = [];
  private decodedTimeRangesValue: readonly BufferedTimeRange[] = [];
  private decodedFrameCountValue = 0;
  private bufferMemory = {
    compressedResidentBytes: 0,
    compressedCapacityBytes: 0,
    decodedResidentBytes: 0,
    decodedCapacityBytes: 0,
    decodedTargetFrames: 0,
  };
  private availableDynamicDetailLevels: readonly number[] | undefined;
  private unavailableQualityLevelsKey = "";
  private disposed = false;
  private operationRevision = 0;
  private pendingPlayRevision: number | undefined;
  private readonly durationSeconds: number;
  private readonly listeners = new Set<SnapshotListener>();
  readonly manifest: GaussianSequenceManifest;
  private readonly minimumReadyFrames: number;
  private readonly playback: SequencePlaybackController;
  private playbackSnapshot: SequencePlaybackSnapshot;
  private qualityModeValue: GaussianStreamingQualityMode = { mode: "automatic" };
  private qualityDiagnosticsValue: GaussianStreamingPlayerSnapshot["qualityDiagnostics"];
  private readonly qualityController: QualityController;
  private readonly now: () => number;
  private readonly loop: boolean;
  private updatingQuality = false;
  private qualityTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly preparationSamples: Array<{ bytes: number; durationMs: number }> =
    [];
  private lastQualityUpdateAt = -Infinity;
  private lastQualityLifecycle: PlayerLifecycleState | undefined;
  private readonly renderer: GaussianRendererAdapter;
  readonly sequence: DynamicGaussianSequence;
  private stallStartedAtMs: number | undefined;
  private stallDurationSeconds = 0;
  private readonly throughputEstimator = new ClientThroughputEstimator();
  private unsubscribeBuffer: (() => void) | undefined;
  private unsubscribePlayback: (() => void) | undefined;

  private constructor(
    manifest: GaussianSequenceManifest,
    sequence: DynamicGaussianSequence,
    renderer: GaussianRendererAdapter,
    buffer: FrameRingBuffer,
    playback: SequencePlaybackController,
    qualityController: QualityController,
    audioClock: MediaPlaybackClock | undefined,
    minimumReadyFrames: number,
    now: () => number,
    loop: boolean,
  ) {
    this.manifest = manifest;
    this.sequence = sequence;
    this.durationSeconds = sequencePlaybackDurationSeconds(
      sequence,
      manifest.durationSeconds,
    );
    this.renderer = renderer;
    this.buffer = buffer;
    this.playback = playback;
    this.playbackSnapshot = playback.snapshot;
    this.qualityController = qualityController;
    this.audioClock = audioClock;
    this.minimumReadyFrames = minimumReadyFrames;
    this.now = now;
    this.loop = loop;
    this.unsubscribeBuffer = buffer.subscribe((snapshot) => {
      this.bufferMemory = {
        compressedResidentBytes: snapshot.compressedBuffer?.residentBytes ?? 0,
        compressedCapacityBytes: snapshot.compressedBuffer?.capacityBytes ?? 0,
        decodedResidentBytes: snapshot.decodedResidentBytes ?? 0,
        decodedCapacityBytes: snapshot.decodedCapacityBytes ?? 0,
        decodedTargetFrames: snapshot.capacity,
      };
      const unavailable = snapshot.unavailableQualityLevels ?? [];
      const unavailableKey = unavailable.join(",");
      if (unavailableKey !== this.unavailableQualityLevelsKey) {
        this.unavailableQualityLevelsKey = unavailableKey;
        this.availableDynamicDetailLevels = sequenceQualityLevels({
          ...this.sequence,
          frames: this.sequence.frames.map((frame) => ({
            ...frame,
            ...(frame.qualityLevels === undefined
              ? {}
              : {
                  qualityLevels: frame.qualityLevels.filter(
                    ({ level }) => !unavailable.includes(level),
                  ),
                }),
          })),
        }).map(({ detailLevel }) => detailLevel);
      }
      // Reuse the emitted buffer snapshot; never scan the cache on UI snapshot reads.
      this.bufferedTimeRangesValue = bufferedTimeRanges(
        snapshot,
        this.sequence,
        this.durationSeconds,
      );
      this.decodedTimeRangesValue = decodedTimeRanges(
        snapshot,
        this.sequence,
        this.durationSeconds,
      );
      this.decodedFrameCountValue = snapshot.frames.filter(
        ({ status }) => status === "ready" || status === "presented",
      ).length;
      this.updateAutomaticQuality();
      this.emit();
    });
    this.unsubscribePlayback = playback.subscribe((snapshot) => {
      this.observePlayback(snapshot);
      this.playbackSnapshot = snapshot;
      this.syncAudio(snapshot);
      this.updateAutomaticQuality();
      this.emit();
    });
    if (audioClock !== undefined) {
      audioClock.onError = (error) => this.handleAudioError(error);
      audioClock.onChange = () => this.emit();
      if (audioClock.error !== undefined) this.handleAudioError(audioClock.error);
    }
    this.scheduleQualityUpdate();
  }

  static async create(
    options: GaussianStreamingPlayerOptions,
  ): Promise<GaussianStreamingPlayer> {
    const manifestOptions: ManifestLoadOptions = {
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    const manifest = await loadManifest(options.manifest, manifestOptions);
    const sequence = selectSequence(manifest, options.sequenceId);
    const renderer = options.renderer;
    let buffer: FrameRingBuffer | undefined;
    let playback: SequencePlaybackController | undefined;
    let audioClock: MediaPlaybackClock | undefined;

    try {
      throwIfAborted(options.signal);
      await renderer.initialise();
      throwIfAborted(options.signal);
      await Promise.all([
        ...manifest.staticObjects.map((object) =>
          renderer.loadStaticObject(object, signalOptions(options.signal)),
        ),
        ...(manifest.meshObjects ?? []).map((object) =>
          renderer.loadMesh(object, signalOptions(options.signal)),
        ),
      ]);
      throwIfAborted(options.signal);

      if (manifest.audio !== undefined) {
        const factory = options.audioElementFactory ?? defaultAudioElementFactory;
        audioClock = new MediaPlaybackClock(
          factory(manifest.audio),
          manifest.audio.offsetSeconds ?? 0,
          options.clock ?? browserClock,
        );
      }
      const clock = audioClock ?? options.clock;
      const durationSeconds = sequencePlaybackDurationSeconds(
        sequence,
        manifest.durationSeconds,
      );
      const bufferOptions = options.buffer ?? {};
      const targetBufferSeconds =
        bufferOptions.targetBufferSeconds ?? DEFAULT_TARGET_BUFFER_SECONDS;
      if (!Number.isFinite(targetBufferSeconds) || targetBufferSeconds <= 0) {
        throw new RangeError("targetBufferSeconds must be a positive finite number.");
      }
      const now =
        options.clock === undefined ? performanceNow : () => options.clock!.now();
      const qualityLevels = sequenceQualityLevels(sequence);
      const futureFrameCount =
        bufferOptions.futureFrameCount ??
        Math.min(
          sequence.frameCount - 1,
          Math.ceil(sequence.frameRate * targetBufferSeconds),
        );
      const minimumDetail = qualityLevels[0]?.detailLevel ?? DEFAULT_MINIMUM_DETAIL;
      const facadeReference: { current?: GaussianStreamingPlayer } = {};
      const initialTransfers: Readonly<FrameRingBufferTraceEvent>[] = [];
      buffer = new FrameRingBuffer({
        decodedBufferMaximumBytes:
          bufferOptions.decodedBufferMaximumBytes ?? DEFAULT_DECODED_BUFFER_BYTES,
        compressedBufferMaximumBytes:
          bufferOptions.compressedBufferMaximumBytes ?? DEFAULT_COMPRESSED_BUFFER_BYTES,
        ...(options.fetch === undefined ? {} : { compressedFrameFetch: options.fetch }),
        ...(options.decoderRegistry === undefined
          ? {}
          : { decoderRegistry: options.decoderRegistry }),
        futureFrameCount,
        durationSeconds,
        loop: options.loop ?? bufferOptions.loop ?? false,
        maximumBasePreparationConcurrency:
          bufferOptions.maximumBasePreparationConcurrency ?? 2,
        maximumCompressedFetchConcurrency:
          bufferOptions.maximumCompressedFetchConcurrency ?? 6,
        maximumRefinementConcurrency: bufferOptions.maximumRefinementConcurrency ?? 1,
        now,
        onTrace: (event) => {
          if (facadeReference.current !== undefined)
            facadeReference.current.observeTrace(event);
          else if (event.type === "compressed-fetch-ready") {
            initialTransfers.push(event);
            if (initialTransfers.length > 32) initialTransfers.shift();
          }
        },
        presentationQualityTarget: {
          detailLevel: minimumDetail,
          minimumSplatCount: 100,
        },
        previousFrameCount: bufferOptions.previousFrameCount ?? 1,
        renderer,
        sequence,
      });
      await buffer.initialise(0);
      const minimumReadyFrames =
        bufferOptions.minimumReadyFrames ??
        Math.min(2, buffer.snapshot.futureFrameCount);
      playback = new SequencePlaybackController({
        buffer,
        ...(clock === undefined ? {} : { clock }),
        durationSeconds,
        loop: options.loop ?? bufferOptions.loop ?? false,
        minimumReadyFrames,
        now,
        sequence,
      });
      const qualityController =
        options.qualityController ??
        new BufferAwareQualityController({
          dynamicObjectId: sequence.id,
          ...(qualityLevels.length === 0
            ? {}
            : { dynamicQualityLevels: qualityLevels }),
          minimumDynamicDetailLevel: minimumDetail,
          minimumSplatCount: 100,
          targetBufferSeconds,
        });
      const facade = new GaussianStreamingPlayer(
        manifest,
        sequence,
        renderer,
        buffer,
        playback,
        qualityController,
        audioClock,
        minimumReadyFrames,
        now,
        options.loop ?? bufferOptions.loop ?? false,
      );
      facadeReference.current = facade;
      for (const event of initialTransfers) facade.observeTrace(event);
      initialTransfers.length = 0;
      facade.updateAutomaticQuality();
      return facade;
    } catch (error) {
      playback?.dispose();
      buffer?.dispose();
      audioClock?.dispose();
      renderer.dispose();
      throw error;
    }
  }

  get snapshot(): GaussianStreamingPlayerSnapshot {
    const playback = this.playbackSnapshot;
    const error = this.audioError ?? playback.error;
    const starting = this.pendingPlayRevision !== undefined;
    return {
      audio: {
        configured: this.audioClock !== undefined,
        muted: this.audioClock?.muted ?? false,
        volume: this.audioClock?.volume ?? 1,
      },
      bufferAheadFrames: playback.bufferAheadFrames,
      bufferedTimeRanges: this.bufferedTimeRangesValue,
      decodedTimeRanges: this.decodedTimeRangesValue,
      decodedFrameCount: this.decodedFrameCountValue,
      bufferDiagnostics: {
        ...this.bufferMemory,
        downloadedAheadSeconds: this.compressedBufferAheadSeconds(
          playback.currentTimeSeconds,
        ),
        decodedAheadSeconds: Math.max(
          0,
          (this.decodedTimeRangesValue.find(
            (range) =>
              range.startSeconds <= playback.currentTimeSeconds + 1e-7 &&
              range.endSeconds > playback.currentTimeSeconds,
          )?.endSeconds ?? playback.currentTimeSeconds) - playback.currentTimeSeconds,
        ),
      },
      currentFrameIndex: playback.currentFrameIndex,
      currentTimeSeconds: playback.currentTimeSeconds,
      droppedFrameCount: playback.droppedFrameCount,
      durationSeconds: this.durationSeconds,
      ...(error === undefined ? {} : { error }),
      isPlaying: error === undefined && (starting || playback.isPlaying),
      lifecycle:
        error !== undefined
          ? "ERROR"
          : starting || (playback.isPlaying && this.audioClock?.waiting)
            ? "BUFFERING"
            : playback.lifecycle,
      manifestId: this.manifest.id,
      qualityMode: { ...this.qualityModeValue },
      ...(this.qualityModeValue.mode !== "automatic" ||
      this.qualityDiagnosticsValue === undefined
        ? {}
        : { qualityDiagnostics: this.qualityDiagnosticsValue }),
      renderer: this.renderer.getMetrics(),
      sequenceId: this.sequence.id,
      ...(playback.presentationTiming === undefined
        ? {}
        : { presentationTiming: playback.presentationTiming }),
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async play(): Promise<void> {
    this.assertOpen();
    if (this.pendingPlayRevision !== undefined || this.playbackSnapshot.isPlaying)
      return;
    const revision = ++this.operationRevision;
    this.audioError = undefined;
    this.pendingPlayRevision = revision;
    this.emit();
    try {
      await this.audioClock?.prime(this.playbackSnapshot.currentTimeSeconds);
      if (this.disposed || revision !== this.operationRevision) return;
      this.pendingPlayRevision = undefined;
      this.playback.play();
    } catch (error) {
      if (this.disposed || revision !== this.operationRevision) return;
      this.handleAudioError(error);
      throw error;
    } finally {
      if (this.pendingPlayRevision === revision) this.pendingPlayRevision = undefined;
      this.emit();
    }
  }

  pause(): void {
    this.assertOpen();
    this.cancelPendingPlay();
    this.playback.pause();
  }

  async seek(timeSeconds: number): Promise<void> {
    this.assertOpen();
    if (!Number.isFinite(timeSeconds)) {
      throw new RangeError("Seek time must be finite.");
    }
    const clamped = Math.min(Math.max(0, timeSeconds), this.durationSeconds);
    this.cancelPendingPlay();
    const revision = this.operationRevision;
    this.audioError = undefined;
    this.playback.pause();
    this.audioClock?.seek(clamped);
    await this.playback.seek(this.frameForTime(clamped), clamped);
    if (!this.disposed && revision === this.operationRevision)
      this.audioClock?.seek(clamped);
  }

  async stepFrames(delta: number): Promise<void> {
    this.assertOpen();
    if (!Number.isInteger(delta)) throw new RangeError("delta must be an integer.");
    this.cancelPendingPlay();
    const revision = this.operationRevision;
    this.audioError = undefined;
    this.playback.pause();
    await this.playback.step(delta);
    if (!this.disposed && revision === this.operationRevision) {
      this.audioClock?.seek(this.playback.snapshot.currentTimeSeconds);
    }
  }

  setQualityMode(mode: GaussianStreamingQualityMode): void {
    this.assertOpen();
    if (mode.mode === "manual") {
      validateUnitValue(mode.detailLevel, "detailLevel");
      if (
        mode.minimumSplatCount !== undefined &&
        (!Number.isInteger(mode.minimumSplatCount) || mode.minimumSplatCount < 0)
      ) {
        throw new RangeError("minimumSplatCount must be a non-negative integer.");
      }
      this.qualityModeValue = { ...mode };
      this.buffer.setPresentationQualityTarget({
        detailLevel: mode.detailLevel,
        minimumSplatCount: mode.minimumSplatCount ?? 100,
      });
      this.refreshPausedQuality();
    } else {
      this.qualityModeValue = { mode: "automatic" };
      this.lastQualityUpdateAt = -Infinity;
      this.updateAutomaticQuality();
    }
    this.emit();
  }

  setMuted(muted: boolean): void {
    this.assertOpen();
    this.audioClock?.setMuted(muted);
    this.emit();
  }

  setVolume(volume: number): void {
    this.assertOpen();
    validateUnitValue(volume, "volume");
    this.audioClock?.setVolume(volume);
    this.emit();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    clearTimeout(this.qualityTimer);
    this.cancelPendingPlay();
    this.unsubscribePlayback?.();
    this.unsubscribeBuffer?.();
    this.playback.dispose();
    this.buffer.dispose();
    this.audioClock?.dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }

  private observeTrace(event: Readonly<FrameRingBufferTraceEvent>): void {
    if (
      event.type === "base-ready" &&
      (event.stageDurationMs ?? 0) > 0 &&
      (event.totalBytes ?? 0) > 0
    ) {
      this.preparationSamples.push({
        bytes: event.totalBytes!,
        durationMs: event.stageDurationMs!,
      });
      if (this.preparationSamples.length > 16) this.preparationSamples.shift();
    }
    if (
      event.type === "compressed-fetch-ready" &&
      event.fromCache !== true &&
      event.durationMs !== undefined &&
      (event.loadedBytes ?? event.totalBytes) !== undefined
    ) {
      this.throughputEstimator.observe(
        event.loadedBytes ?? event.totalBytes ?? 0,
        event.durationMs,
        event.atMs,
      );
      this.updateAutomaticQuality();
    }
  }

  private updateAutomaticQuality(): void {
    if (
      this.qualityModeValue.mode !== "automatic" ||
      this.disposed ||
      this.updatingQuality
    ) {
      return;
    }
    this.updatingQuality = true;
    try {
      const now = this.now();
      // Buffer/renderer callbacks can be nested and arrive many times per frame.
      // Observe wall time, while still reacting immediately to lifecycle changes.
      if (
        now - this.lastQualityUpdateAt < 250 &&
        this.playbackSnapshot.lifecycle === this.lastQualityLifecycle
      )
        return;
      const playback = this.toPlaybackState();
      this.lastQualityUpdateAt = now;
      this.lastQualityLifecycle = playback.lifecycle;
      const network: NetworkState = this.throughputEstimator.getState(now) ?? {
        confidence: 0,
        estimatedThroughputBps: 0,
        source: "client-measured",
        timestampMs: now,
      };
      const metrics = this.toPlayerMetrics(now, playback);
      const decision = this.qualityController.update(playback, network, metrics);
      this.qualityDiagnosticsValue = Object.freeze({
        bufferAheadSeconds: playback.bufferAheadSeconds,
        ...(metrics.compressedBufferAheadSeconds === undefined
          ? {}
          : {
              compressedBufferAheadSeconds: metrics.compressedBufferAheadSeconds,
            }),
        dynamicFrameDetailLevel:
          decision.dynamicFrameDetailLevel ?? DEFAULT_MINIMUM_DETAIL,
        estimatedThroughputBps: network.estimatedThroughputBps,
        networkConfidence: network.confidence ?? 0,
        targetBufferSeconds: decision.targetBufferSeconds,
        targetFramesPerSecond: this.sequence.frameRate,
      });
      this.buffer.setPresentationQualityTarget(
        {
          detailLevel: decision.dynamicFrameDetailLevel ?? DEFAULT_MINIMUM_DETAIL,
          minimumSplatCount: decision.minimumDynamicSplatCount ?? 100,
        },
        { preservePreparedFrames: playback.isPlaying },
      );
      this.refreshPausedQuality();
      if (decision.maximumBasePreparationConcurrency !== undefined) {
        this.buffer.setPreparationConcurrency(
          decision.maximumBasePreparationConcurrency,
          decision.maximumRefinementConcurrency ?? 1,
        );
      }
      this.renderer.setRenderQuality(decision);
    } finally {
      this.updatingQuality = false;
    }
  }

  private scheduleQualityUpdate(): void {
    this.qualityTimer = setTimeout(() => {
      if (this.disposed) return;
      this.updateAutomaticQuality();
      if (!this.disposed) this.scheduleQualityUpdate();
    }, 250);
  }

  private toPlaybackState(): PlaybackState {
    // Read current readiness: preparing a future frame does not emit a playback event.
    const snapshot = this.playback.snapshot;
    return {
      bufferAheadSeconds: snapshot.bufferAheadSeconds,
      currentFrameIndex: snapshot.currentFrameIndex,
      currentTimeSeconds: snapshot.currentTimeSeconds,
      isPlaying: snapshot.isPlaying,
      lifecycle: snapshot.lifecycle,
      minimumReadyFrames: this.minimumReadyFrames,
      playbackRate: 1,
    };
  }

  private refreshPausedQuality(): void {
    const snapshot = this.playbackSnapshot;
    if (
      snapshot.isPlaying ||
      this.pendingPlayRevision !== undefined ||
      (snapshot.lifecycle !== "READY" &&
        snapshot.lifecycle !== "PAUSED" &&
        snapshot.lifecycle !== "ENDED")
    )
      return;
    if (!this.buffer.invalidateCurrentTransfer()) return;
    // The playback controller owns cancellation if Play, Seek or another quality
    // selection supersedes this refresh. Keep the exact media position.
    void this.playback
      .seek(this.frameForTime(snapshot.currentTimeSeconds), snapshot.currentTimeSeconds)
      .catch(() => undefined); // The controller exposes preparation failures in its snapshot.
  }

  private toPlayerMetrics(
    now: number,
    playback: Readonly<PlaybackState>,
  ): PlayerMetrics {
    const buffer = this.buffer.snapshot;
    const frames = buffer.frames;
    const requested = frames.filter((frame) => frame.requestedBytes > 0);
    const estimatedBaseFrameBytes =
      requested.length === 0
        ? undefined
        : requested.reduce((sum, frame) => sum + frame.requestedBytes, 0) /
          requested.length;
    const renderFramesPerSecond = this.renderer.getMetrics().renderFramesPerSecond;
    return {
      timestampMs: now,
      ...(this.availableDynamicDetailLevels === undefined
        ? {}
        : { availableDynamicDetailLevels: this.availableDynamicDetailLevels }),
      ...(buffer.compressedBuffer === undefined
        ? {}
        : {
            compressedBufferAheadSeconds: this.compressedBufferAheadSeconds(
              playback.currentTimeSeconds,
            ),
            compressedBufferCapacityBytes: buffer.compressedBuffer.capacityBytes,
            compressedBufferWindowSeconds: this.loop
              ? this.durationSeconds
              : Math.max(0, this.durationSeconds - playback.currentTimeSeconds),
          }),
      bufferCapacitySeconds:
        Math.min(
          buffer.futureFrameCount,
          this.sequence.frameCount - 1,
          this.loop
            ? Infinity
            : this.sequence.frameCount - 1 - playback.currentFrameIndex,
        ) / this.sequence.frameRate,
      downloadedBytes: frames.reduce((sum, frame) => sum + frame.downloadedBytes, 0),
      droppedFrames: this.playbackSnapshot.droppedFrameCount,
      ...(this.preparationSamples.length === 0
        ? {}
        : {
            estimatedPreparationBytesPerSecond:
              ((buffer.maximumBasePreparationConcurrency ?? 2) *
                1_000 *
                this.preparationSamples.reduce(
                  (sum, sample) => sum + sample.bytes,
                  0,
                )) /
              this.preparationSamples.reduce(
                (sum, sample) => sum + sample.durationMs,
                0,
              ),
          }),
      ...(estimatedBaseFrameBytes === undefined ? {} : { estimatedBaseFrameBytes }),
      ...(renderFramesPerSecond === undefined ? {} : { renderFramesPerSecond }),
      stallDurationSeconds: this.stallDurationSeconds,
      targetFramesPerSecond: this.sequence.frameRate,
    };
  }

  private compressedBufferAheadSeconds(currentTime: number): number {
    const ranges = this.bufferedTimeRangesValue;
    const range = ranges.find(
      ({ startSeconds, endSeconds }) =>
        startSeconds <= currentTime + 1e-7 && currentTime < endSeconds,
    );
    if (range === undefined) return 0;
    if (!this.loop || range.endSeconds < this.durationSeconds)
      return range.endSeconds - currentTime;
    const first = ranges[0];
    // A fully resident looping clip provides an uninterrupted reserve every cycle.
    if (first === range && first.startSeconds === 0) return this.durationSeconds;
    return (
      range.endSeconds -
      currentTime +
      (first?.startSeconds === 0 ? first.endSeconds : 0)
    );
  }

  private observePlayback(snapshot: SequencePlaybackSnapshot): void {
    const now = this.now();
    if (snapshot.lifecycle === "BUFFERING") {
      this.stallStartedAtMs ??= now;
    } else if (this.stallStartedAtMs !== undefined) {
      this.stallDurationSeconds += (now - this.stallStartedAtMs) / 1000;
      this.stallStartedAtMs = undefined;
    }
  }

  private syncAudio(snapshot: SequencePlaybackSnapshot): void {
    // An earlier seek may finish while Play is still unlocking the media element.
    // Its paused snapshot must not cancel that newer gesture's pending prime.
    if (
      this.audioClock === undefined ||
      this.pendingPlayRevision !== undefined ||
      snapshot.lifecycle === "SEEKING"
    ) {
      return;
    }
    this.audioClock.synchronise(
      snapshot.currentTimeSeconds,
      snapshot.lifecycle === "PLAYING",
    );
  }

  private cancelPendingPlay(): void {
    this.operationRevision += 1;
    this.pendingPlayRevision = undefined;
    this.audioClock?.stop();
  }

  private handleAudioError(error: unknown): void {
    if (this.disposed) return;
    this.audioError = error;
    this.cancelPendingPlay();
    this.playback.pause();
  }

  private frameForTime(timeSeconds: number): number {
    let selected = 0;
    for (const frame of this.sequence.frames) {
      if (frame.timestampSeconds > timeSeconds) {
        break;
      }
      selected = frame.frameIndex;
    }
    return selected;
  }

  private emit(): void {
    if (this.disposed) {
      return;
    }
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("The Gaussian streaming player has been disposed.");
    }
  }
}

const browserClock: PlaybackClock = {
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: performanceNow,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

function defaultAudioElementFactory(
  track: Readonly<MediaTrack>,
): GaussianStreamingMediaElement {
  if (typeof Audio === "undefined") {
    throw new Error(
      "This manifest has audio, but no audioElementFactory was supplied outside a browser.",
    );
  }
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.src = track.url;
  return audio;
}

function selectSequence(
  manifest: GaussianSequenceManifest,
  sequenceId: string | undefined,
): DynamicGaussianSequence {
  if (sequenceId !== undefined) {
    const selected = manifest.dynamicSequences.find(({ id }) => id === sequenceId);
    if (selected === undefined) {
      throw new Error(
        `Manifest '${manifest.id}' has no dynamic sequence '${sequenceId}'.`,
      );
    }
    return selected;
  }
  if (manifest.dynamicSequences.length !== 1) {
    throw new Error(
      `Manifest '${manifest.id}' has ${manifest.dynamicSequences.length} dynamic sequences; sequenceId is required.`,
    );
  }
  return manifest.dynamicSequences[0]!;
}

function signalOptions(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException("Player creation was aborted.", "AbortError");
  }
}

function validateUnitValue(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between zero and one.`);
  }
}

function performanceNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
