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
const DEFAULT_FUTURE_FRAMES = 10;
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
  currentFrameIndex: number;
  currentTimeSeconds: number;
  droppedFrameCount: number;
  durationSeconds: number;
  error?: unknown;
  isPlaying: boolean;
  lifecycle: PlayerLifecycleState;
  manifestId: string;
  qualityMode: GaussianStreamingQualityMode;
  renderer: RendererMetrics;
  sequenceId: string;
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
  private readonly qualityController: QualityController;
  private readonly now: () => number;
  private readonly loop: boolean;
  private updatingQuality = false;
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
    this.unsubscribeBuffer = buffer.subscribe(() => {
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
      const now =
        options.clock === undefined ? performanceNow : () => options.clock!.now();
      const qualityLevels = sequenceQualityLevels(sequence);
      const minimumDetail = qualityLevels[0]?.detailLevel ?? DEFAULT_MINIMUM_DETAIL;
      const facadeReference: { current?: GaussianStreamingPlayer } = {};
      const initialTransfers: Readonly<FrameRingBufferTraceEvent>[] = [];
      buffer = new FrameRingBuffer({
        compressedBufferMaximumBytes:
          bufferOptions.compressedBufferMaximumBytes ?? DEFAULT_COMPRESSED_BUFFER_BYTES,
        ...(options.fetch === undefined ? {} : { compressedFrameFetch: options.fetch }),
        ...(options.decoderRegistry === undefined
          ? {}
          : { decoderRegistry: options.decoderRegistry }),
        futureFrameCount: bufferOptions.futureFrameCount ?? DEFAULT_FUTURE_FRAMES,
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
        Math.min(2, bufferOptions.futureFrameCount ?? DEFAULT_FUTURE_FRAMES);
      playback = new SequencePlaybackController({
        buffer,
        ...(clock === undefined ? {} : { clock }),
        durationSeconds,
        loop: options.loop ?? bufferOptions.loop ?? false,
        minimumReadyFrames,
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
          targetBufferSeconds:
            (Math.max(
              1,
              Math.min(
                bufferOptions.futureFrameCount ?? DEFAULT_FUTURE_FRAMES,
                sequence.frameCount - 1,
              ),
            ) *
              0.7) /
            sequence.frameRate,
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
      renderer: this.renderer.getMetrics(),
      sequenceId: this.sequence.id,
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
      this.audioClock?.seek(this.frameTime(this.playback.snapshot.currentFrameIndex));
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
      const playback = this.toPlaybackState();
      // Buffer/renderer callbacks can be nested and arrive many times per frame.
      // Observe wall time, while still reacting immediately to lifecycle changes.
      if (
        now - this.lastQualityUpdateAt < 250 &&
        playback.lifecycle === this.lastQualityLifecycle
      )
        return;
      this.lastQualityUpdateAt = now;
      this.lastQualityLifecycle = playback.lifecycle;
      const network: NetworkState = this.throughputEstimator.getState(now) ?? {
        confidence: 0,
        estimatedThroughputBps: 0,
        source: "client-measured",
        timestampMs: now,
      };
      const metrics = this.toPlayerMetrics(now);
      const decision = this.qualityController.update(playback, network, metrics);
      this.buffer.setPresentationQualityTarget(
        {
          detailLevel: decision.dynamicFrameDetailLevel ?? DEFAULT_MINIMUM_DETAIL,
          minimumSplatCount: decision.minimumDynamicSplatCount ?? 100,
        },
        { preservePreparedFrames: true },
      );
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

  private toPlayerMetrics(now: number): PlayerMetrics {
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
      bufferCapacitySeconds:
        Math.min(
          buffer.futureFrameCount,
          this.sequence.frameCount - 1,
          this.loop
            ? Infinity
            : this.sequence.frameCount - 1 - this.playbackSnapshot.currentFrameIndex,
        ) / this.sequence.frameRate,
      downloadedBytes: frames.reduce((sum, frame) => sum + frame.downloadedBytes, 0),
      droppedFrames: this.playbackSnapshot.droppedFrameCount,
      ...(estimatedBaseFrameBytes === undefined ? {} : { estimatedBaseFrameBytes }),
      ...(renderFramesPerSecond === undefined ? {} : { renderFramesPerSecond }),
      stallDurationSeconds: this.stallDurationSeconds,
      targetFramesPerSecond: this.sequence.frameRate,
    };
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

  private frameTime(frameIndex: number): number {
    return this.sequence.frames[frameIndex]?.timestampSeconds ?? 0;
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
