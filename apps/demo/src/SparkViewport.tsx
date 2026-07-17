import {
  BufferAwareQualityController,
  ClientThroughputEstimator,
  FrameRingBuffer,
  SequencePlaybackController,
} from "@6g-path/gaussian-player";
import {
  cloneSparkRenderQuality,
  DEFAULT_SPARK_RENDER_QUALITY,
  SparkGaussianRendererAdapter,
} from "@6g-path/gaussian-renderer-spark";
import { useEffect, useRef, useState } from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { DynamicSequenceControls } from "./DynamicSequenceControls.js";
import { DynamicTransferQualityControls } from "./DynamicTransferQualityControls.js";
import {
  hasLocalDynamicSequenceConfiguration,
  loadLocalDynamicSequence,
} from "./localDynamicSequence.js";
import { RendererMetricsOverlay } from "./RendererMetricsOverlay.js";
import {
  CAPTURE_TO_THREE_TRANSFORM,
  createCaptureToThreeTransform,
  withUniformScale,
} from "./sceneCoordinates.js";
import { SceneScaleControls } from "./SceneScaleControls.js";
import { SparkQualityControls } from "./SparkQualityControls.js";

import type {
  DynamicGaussianSequence,
  FrameRingBufferSnapshot,
  FrameRingBufferTraceEvent,
  GaussianQualityLevel,
  PlayerLifecycleState,
  RendererMetrics,
  SequencePlaybackSnapshot,
} from "@6g-path/gaussian-player";
import type { SparkRenderQualityConfiguration } from "@6g-path/gaussian-renderer-spark";

type RendererStatus = "initialising" | "ready" | "unavailable";
type StaticAssetStatus = "failed" | "loading" | "not-configured" | "ready";
type DynamicAssetStatus = "failed" | "loading" | "not-configured" | "ready";

const staticRadUrl = import.meta.env.VITE_STATIC_RAD_URL;
const dynamicSequenceConfigured = hasLocalDynamicSequenceConfiguration(import.meta.env);
const preloadCompleteDynamicSequence =
  import.meta.env.VITE_DYNAMIC_PRELOAD_ALL_FRAMES === "true";
const dynamicSequenceId = "local-dynamic-sequence";
const minimumDynamicSplatCount = 100;
const defaultDynamicTransferDetail = 0.25;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const compressedBufferMaximumBytes =
  positiveInteger(import.meta.env.VITE_DYNAMIC_COMPRESSED_BUFFER_MB, 200) * 1_000_000;
const dynamicDecodeConcurrency = positiveInteger(
  import.meta.env.VITE_DYNAMIC_DECODE_CONCURRENCY,
  4,
);
const dynamicFetchConcurrency = positiveInteger(
  import.meta.env.VITE_DYNAMIC_FETCH_CONCURRENCY,
  6,
);
const dynamicTargetBufferSeconds = positiveNumber(
  import.meta.env.VITE_DYNAMIC_TARGET_BUFFER_SECONDS,
  5,
);

function createInitialQuality(): SparkRenderQualityConfiguration {
  return {
    ...cloneSparkRenderQuality(DEFAULT_SPARK_RENDER_QUALITY),
    dynamicSequenceWeights: { [dynamicSequenceId]: 1 },
    splatBudget: 1_500_000,
  };
}

interface SparkViewportProps {
  onBufferTrace?(event: Readonly<FrameRingBufferTraceEvent>): void;
  onPlaybackSnapshot?(snapshot: Readonly<SequencePlaybackSnapshot>): void;
}

export function SparkViewport({
  onBufferTrace,
  onPlaybackSnapshot,
}: SparkViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<SparkGaussianRendererAdapter | null>(null);
  const bufferRef = useRef<FrameRingBuffer | null>(null);
  const playbackRef = useRef<SequencePlaybackController | null>(null);
  const bufferTraceListenerRef = useRef(onBufferTrace);
  const playbackSnapshotListenerRef = useRef(onPlaybackSnapshot);
  const [adaptiveQualityEnabled, setAdaptiveQualityEnabled] = useState(false);
  const adaptiveQualityEnabledRef = useRef(adaptiveQualityEnabled);
  const dynamicSequenceRef = useRef<DynamicGaussianSequence | undefined>(undefined);
  const [dynamicAssetStatus, setDynamicAssetStatus] = useState<DynamicAssetStatus>(
    dynamicSequenceConfigured ? "loading" : "not-configured",
  );
  const [dynamicSequence, setDynamicSequence] = useState<DynamicGaussianSequence>();
  const [dynamicTransferLevels, setDynamicTransferLevels] = useState<
    readonly GaussianQualityLevel[]
  >([]);
  const [manualDynamicTransferDetail, setManualDynamicTransferDetail] = useState(
    defaultDynamicTransferDetail,
  );
  const manualDynamicTransferDetailRef = useRef(defaultDynamicTransferDetail);
  const transferChangeRevisionRef = useRef(0);
  const [presentedTransferLevel, setPresentedTransferLevel] = useState<number>();
  const [dynamicFrameIndex, setDynamicFrameIndex] = useState(0);
  const [isDynamicPlaying, setIsDynamicPlaying] = useState(false);
  const [dynamicPlaybackLifecycle, setDynamicPlaybackLifecycle] =
    useState<PlayerLifecycleState>("IDLE");
  const [metrics, setMetrics] = useState<RendererMetrics>();
  const [preparedFrameCount, setPreparedFrameCount] = useState(0);
  const [compressedBuffer, setCompressedBuffer] =
    useState<FrameRingBufferSnapshot["compressedBuffer"]>();
  const [quality, setQuality] = useState(createInitialQuality);
  const qualityRef = useRef(quality);
  const [dynamicActorScale, setDynamicActorScale] = useState(1);
  const [status, setStatus] = useState<RendererStatus>("initialising");
  const [staticSceneScale, setStaticSceneScale] = useState(1);
  const [staticAssetStatus, setStaticAssetStatus] = useState<StaticAssetStatus>(
    staticRadUrl === undefined ? "not-configured" : "loading",
  );

  useEffect(() => {
    adaptiveQualityEnabledRef.current = adaptiveQualityEnabled;
  }, [adaptiveQualityEnabled]);

  useEffect(() => {
    bufferTraceListenerRef.current = onBufferTrace;
  }, [onBufferTrace]);

  useEffect(() => {
    playbackSnapshotListenerRef.current = onPlaybackSnapshot;
  }, [onPlaybackSnapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    let active = true;
    let controls: OrbitControls | undefined;
    let rendererInitialised = false;
    let metricsTimer: number | undefined;
    let unsubscribeBuffer: (() => void) | undefined;
    let unsubscribePlayback: (() => void) | undefined;
    const controller = new AbortController();
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      canvas,
      onRenderTiming: ({
        atMs,
        displayCommitIntervalsMs,
        flatFrameCopySamplesMs,
        frameIndex,
        renderCallSamplesMs,
        renderIntervalSamplesMs,
        sortOrderingUploadSamplesMs,
        sortReadbackSamplesMs,
        sortSamplesMs,
        sortWorkerSamplesMs,
        sparkUpdateSamplesMs,
      }) => {
        bufferTraceListenerRef.current?.({
          atMs,
          displayCommitIntervalsMs,
          flatFrameCopySamplesMs,
          ...(frameIndex === undefined ? {} : { frameIndex }),
          renderCallSamplesMs,
          renderIntervalSamplesMs,
          sortOrderingUploadSamplesMs,
          sortReadbackSamplesMs,
          sortSamplesMs,
          sortWorkerSamplesMs,
          sparkUpdateSamplesMs,
          type: "render-timing",
        });
      },
    });
    const throughputEstimator = new ClientThroughputEstimator();
    let activeDynamicSequence: DynamicGaussianSequence | undefined;
    let qualityController: BufferAwareQualityController | undefined;
    let latestBaseFrameBytes: number | undefined;

    async function initialiseRenderer() {
      try {
        await adapter.initialise();
        rendererInitialised = true;
        adapter.setSparkRenderQuality(qualityRef.current);
        adapterRef.current = adapter;
        controls = new OrbitControls(adapter.camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxDistance = 100;
        controls.minDistance = 0.05;
        controls.screenSpacePanning = true;
        controls.target.set(0, 0, 0);
        controls.update();
        adapter.renderer.setAnimationLoop(() => {
          controls?.update();
          adapter.render();
        });
        metricsTimer = window.setInterval(() => {
          if (active) {
            const rendererMetrics = adapter.getMetrics();
            setMetrics(rendererMetrics);
            const buffer = bufferRef.current;
            const playback = playbackRef.current;
            const network = throughputEstimator.getState(performance.now());
            if (
              adaptiveQualityEnabledRef.current &&
              buffer !== null &&
              playback !== null &&
              network !== undefined &&
              activeDynamicSequence !== undefined &&
              qualityController !== undefined
            ) {
              const dynamicSequence = activeDynamicSequence;
              const playbackSnapshot = playback.snapshot;
              const compressedSnapshot = buffer.snapshot.compressedBuffer;
              const compressedAheadSeconds =
                Math.max(0, (compressedSnapshot?.contiguousReadyFrameCount ?? 0) - 1) /
                dynamicSequence.frameRate;
              const bufferedAheadSeconds = Math.max(
                playbackSnapshot.bufferAheadFrames / dynamicSequence.frameRate,
                compressedAheadSeconds,
              );
              const decision = qualityController.update(
                {
                  bufferAheadSeconds: bufferedAheadSeconds,
                  currentFrameIndex: playbackSnapshot.currentFrameIndex,
                  currentTimeSeconds: playbackSnapshot.currentTimeSeconds,
                  isPlaying: playbackSnapshot.isPlaying,
                  lifecycle: playbackSnapshot.lifecycle,
                  minimumReadyFrames: 2,
                  playbackRate: 1,
                },
                network,
                {
                  bufferOccupancyRatio:
                    compressedSnapshot === undefined
                      ? playbackSnapshot.bufferAheadFrames /
                        Math.max(1, buffer.snapshot.futureFrameCount)
                      : compressedSnapshot.residentBytes /
                        compressedSnapshot.capacityBytes,
                  downloadedBytes:
                    compressedSnapshot?.residentBytes ??
                    buffer.snapshot.frames.reduce(
                      (sum, frame) => sum + frame.downloadedBytes,
                      0,
                    ),
                  droppedFrames: playbackSnapshot.droppedFrameCount,
                  ...(latestBaseFrameBytes === undefined
                    ? {}
                    : { estimatedBaseFrameBytes: latestBaseFrameBytes }),
                  ...(rendererMetrics.renderFramesPerSecond === undefined
                    ? {}
                    : {
                        renderFramesPerSecond: rendererMetrics.renderFramesPerSecond,
                      }),
                  stallDurationSeconds: 0,
                  targetFramesPerSecond: dynamicSequence.frameRate,
                },
              );
              buffer.setPreparationConcurrency(
                decision.maximumBasePreparationConcurrency ?? 2,
                decision.maximumRefinementConcurrency ?? 1,
              );
              buffer.setPresentationQualityTarget({
                detailLevel:
                  decision.dynamicFrameDetailLevel ?? defaultDynamicTransferDetail,
                minimumSplatCount: decision.minimumDynamicSplatCount ?? 2,
              });
              adapter.setRenderQuality(decision);
              const adaptedQuality = adapter.getSparkRenderQuality();
              qualityRef.current = adaptedQuality;
              setQuality(adaptedQuality);
            }
          }
        }, 500);

        await adapter.loadMesh(
          {
            id: "demo-marker",
            transform: {
              position: { x: 0, y: 0, z: 0 },
              scale: { x: 0.75, y: 0.75, z: 0.75 },
            },
            url: "/assets/marker.gltf",
          },
          { signal: controller.signal },
        );
        if (active) {
          setStatus("ready");
        }

        if (staticRadUrl !== undefined) {
          try {
            await adapter.loadStaticObject(
              {
                id: "demo-static-rad",
                transform: CAPTURE_TO_THREE_TRANSFORM,
                url: staticRadUrl,
              },
              { signal: controller.signal },
            );
            if (active) {
              setStaticAssetStatus("ready");
            }
          } catch (error) {
            if (active && !controller.signal.aborted) {
              console.error("Unable to load the configured static RAD asset.", error);
              setStaticAssetStatus("failed");
            }
          }
        }

        const loadedDynamicSequence = await loadLocalDynamicSequence(import.meta.env, {
          signal: controller.signal,
        });
        if (loadedDynamicSequence !== undefined) {
          activeDynamicSequence = loadedDynamicSequence;
          dynamicSequenceRef.current = loadedDynamicSequence;
          if (active) {
            setDynamicSequence(loadedDynamicSequence);
          }
          const transferLevels = getDynamicTransferLevels(loadedDynamicSequence);
          const initialTransferDetail =
            transferLevels.find(({ minimumPlayable }) => minimumPlayable)
              ?.detailLevel ??
            transferLevels[0]?.detailLevel ??
            defaultDynamicTransferDetail;
          manualDynamicTransferDetailRef.current = initialTransferDetail;
          if (active) {
            setDynamicTransferLevels(transferLevels);
            setManualDynamicTransferDetail(initialTransferDetail);
          }
          qualityController = new BufferAwareQualityController({
            dynamicObjectId: loadedDynamicSequence.id,
            minimumSplatCount: minimumDynamicSplatCount,
            targetBufferSeconds: dynamicTargetBufferSeconds,
          });
          const dynamicSequence = loadedDynamicSequence;
          const futureFrameCount = preloadCompleteDynamicSequence
            ? Math.max(0, dynamicSequence.frameCount - 1)
            : 3;
          const buffer = new FrameRingBuffer({
            compressedBufferMaximumBytes,
            futureFrameCount,
            loop: true,
            maximumBasePreparationConcurrency: dynamicDecodeConcurrency,
            maximumCompressedFetchConcurrency: dynamicFetchConcurrency,
            maximumRefinementConcurrency: 1,
            onTrace: (event) => {
              if (
                event.type === "compressed-fetch-ready" &&
                event.durationMs !== undefined &&
                event.loadedBytes !== undefined
              ) {
                latestBaseFrameBytes = event.loadedBytes;
                throughputEstimator.observe(
                  event.loadedBytes,
                  event.durationMs,
                  event.atMs,
                );
              }
              bufferTraceListenerRef.current?.(event);
            },
            previousFrameCount: preloadCompleteDynamicSequence ? 0 : 1,
            presentationQualityTarget: {
              detailLevel: initialTransferDetail,
              minimumSplatCount: minimumDynamicSplatCount,
            },
            renderer: adapter,
            sequence: dynamicSequence,
          });
          bufferRef.current = buffer;
          unsubscribeBuffer = buffer.subscribe(
            ({ compressedBuffer, currentFrameIndex, frames }) => {
              if (active) {
                setCompressedBuffer(compressedBuffer);
                setPreparedFrameCount(
                  frames.filter(
                    ({ status }) =>
                      status === "base-ready" ||
                      status === "refining" ||
                      status === "ready" ||
                      status === "presented",
                  ).length,
                );
                setPresentedTransferLevel(
                  frames.find(
                    ({ frameIndex, status }) =>
                      frameIndex === currentFrameIndex && status === "presented",
                  )?.qualityLevel,
                );
              }
            },
          );
          try {
            await buffer.initialise(0);
            if (preloadCompleteDynamicSequence) {
              await buffer.whenBuffered();
            }
            if (active) {
              const playback = new SequencePlaybackController({
                buffer,
                loop: true,
                minimumReadyFrames: 2,
                sequence: dynamicSequence,
              });
              playbackRef.current = playback;
              unsubscribePlayback = playback.subscribe((snapshot) => {
                if (!active) {
                  return;
                }
                setDynamicFrameIndex(snapshot.currentFrameIndex);
                setDynamicPlaybackLifecycle(snapshot.lifecycle);
                setIsDynamicPlaying(snapshot.isPlaying);
                playbackSnapshotListenerRef.current?.(snapshot);
                if (snapshot.lifecycle === "ERROR") {
                  console.error("Dynamic sequence playback failed.", snapshot.error);
                  setDynamicAssetStatus("failed");
                }
              });
              setDynamicAssetStatus("ready");
            }
          } catch (error) {
            buffer.dispose();
            if (bufferRef.current === buffer) {
              bufferRef.current = null;
            }
            if (active && !controller.signal.aborted) {
              console.error(
                "Unable to load the configured dynamic GS sequence.",
                error,
              );
              setDynamicAssetStatus("failed");
            }
          }
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          console.error("Unable to initialise the Spark demo viewport.", error);
          setStatus("unavailable");
        }
      }
    }

    void initialiseRenderer();

    return () => {
      active = false;
      controller.abort();
      adapterRef.current = null;
      dynamicSequenceRef.current = undefined;
      unsubscribePlayback?.();
      playbackRef.current?.dispose();
      playbackRef.current = null;
      unsubscribeBuffer?.();
      bufferRef.current?.dispose();
      bufferRef.current = null;
      if (metricsTimer !== undefined) {
        window.clearInterval(metricsTimer);
      }
      controls?.dispose();
      if (rendererInitialised) {
        adapter.renderer.setAnimationLoop(null);
      }
      adapter.dispose();
    };
  }, []);

  function updateQuality(configuration: SparkRenderQualityConfiguration) {
    qualityRef.current = configuration;
    setQuality(configuration);
    adapterRef.current?.setSparkRenderQuality(configuration);
  }

  function updateAdaptiveQuality(enabled: boolean) {
    setAdaptiveQualityEnabled(enabled);
    if (!enabled) {
      bufferRef.current?.setPresentationQualityTarget({
        detailLevel: manualDynamicTransferDetailRef.current,
        minimumSplatCount: minimumDynamicSplatCount,
      });
    }
  }

  function updateDynamicTransferDetail(detailLevel: number) {
    playbackRef.current?.pause();
    manualDynamicTransferDetailRef.current = detailLevel;
    setManualDynamicTransferDetail(detailLevel);
    const buffer = bufferRef.current;
    if (buffer === null) {
      return;
    }
    buffer.setPresentationQualityTarget({
      detailLevel,
      minimumSplatCount: minimumDynamicSplatCount,
    });
    if (preloadCompleteDynamicSequence) {
      const revision = transferChangeRevisionRef.current + 1;
      transferChangeRevisionRef.current = revision;
      setDynamicAssetStatus("loading");
      void buffer.whenBuffered().then(
        () => {
          if (
            bufferRef.current === buffer &&
            transferChangeRevisionRef.current === revision
          ) {
            setDynamicAssetStatus("ready");
          }
        },
        (error: unknown) => {
          if (
            bufferRef.current === buffer &&
            transferChangeRevisionRef.current === revision
          ) {
            console.error("Unable to preload the selected SPZ tier.", error);
            setDynamicAssetStatus("failed");
          }
        },
      );
    }
  }

  function updateStaticSceneScale(scale: number) {
    setStaticSceneScale(scale);
    adapterRef.current?.setObjectTransform(
      "demo-static-rad",
      createCaptureToThreeTransform(scale),
    );
  }

  function updateDynamicActorScale(scale: number) {
    const playback = playbackRef.current;
    if (
      playback !== null &&
      (playback.snapshot.isPlaying || playback.snapshot.lifecycle === "SEEKING")
    ) {
      playback.pause();
    }
    setDynamicActorScale(scale);
    bufferRef.current?.setTransform(
      withUniformScale(
        dynamicSequenceRef.current?.transform ?? CAPTURE_TO_THREE_TRANSFORM,
        scale,
      ),
    );
  }

  function stepDynamicFrame(delta: number) {
    void playbackRef.current?.step(delta).catch((error: unknown) => {
      console.error("Unable to present the requested dynamic GS frame.", error);
      setDynamicAssetStatus("failed");
    });
  }

  function toggleDynamicPlayback() {
    const playback = playbackRef.current;
    if (playback === null) {
      return;
    }
    if (playback.snapshot.isPlaying) {
      playback.pause();
    } else {
      playback.play();
    }
  }

  const sourceFrameIndex =
    dynamicSequence?.frames[dynamicFrameIndex]?.metadata?.sourceFrameIndex;

  return (
    <div className="spark-viewport">
      <canvas ref={canvasRef} aria-label="Gaussian scene viewport" />
      <p className="navigation-hint">
        Drag to orbit · Right-drag to pan · Scroll to zoom
      </p>
      <div className="viewport-control-stack">
        <SparkQualityControls
          adaptive={adaptiveQualityEnabled}
          configuration={quality}
          disabled={status !== "ready"}
          onAdaptiveChange={updateAdaptiveQuality}
          onChange={updateQuality}
        />
        {dynamicTransferLevels.length === 0 ? null : (
          <DynamicTransferQualityControls
            adaptive={adaptiveQualityEnabled}
            disabled={dynamicAssetStatus !== "ready"}
            levels={dynamicTransferLevels}
            onChange={updateDynamicTransferDetail}
            {...(presentedTransferLevel === undefined
              ? {}
              : { presentedLevel: presentedTransferLevel })}
            selectedDetailLevel={manualDynamicTransferDetail}
          />
        )}
        <SceneScaleControls
          disabled={status !== "ready"}
          dynamicDisabled={
            dynamicAssetStatus !== "ready" ||
            isDynamicPlaying ||
            dynamicPlaybackLifecycle === "SEEKING"
          }
          dynamicScale={dynamicActorScale}
          onDynamicScaleChange={updateDynamicActorScale}
          onStaticScaleChange={updateStaticSceneScale}
          staticDisabled={staticAssetStatus !== "ready"}
          staticScale={staticSceneScale}
        />
      </div>
      <RendererMetricsOverlay compressedBuffer={compressedBuffer} metrics={metrics} />
      {dynamicSequence === undefined ||
      dynamicAssetStatus === "not-configured" ? null : (
        <DynamicSequenceControls
          disabled={
            dynamicAssetStatus !== "ready" || dynamicPlaybackLifecycle === "SEEKING"
          }
          frameCount={dynamicSequence.frameCount}
          frameIndex={dynamicFrameIndex}
          isPlaying={isDynamicPlaying}
          isBuffering={dynamicPlaybackLifecycle === "BUFFERING"}
          onNext={() => stepDynamicFrame(1)}
          onPlayPause={toggleDynamicPlayback}
          onPrevious={() => stepDynamicFrame(-1)}
          preparedFrameCount={preparedFrameCount}
          sourceFrameIndex={
            typeof sourceFrameIndex === "number" ? sourceFrameIndex : dynamicFrameIndex
          }
          status={dynamicAssetStatus}
        />
      )}
      <p className="renderer-status" data-renderer-status={status}>
        {status === "ready"
          ? "Renderer ready"
          : status === "unavailable"
            ? "Renderer unavailable"
            : "Initialising renderer"}
      </p>
      {staticAssetStatus === "not-configured" ? null : (
        <p className="static-asset-status" data-static-asset-status={staticAssetStatus}>
          {staticAssetStatus === "ready"
            ? "Static RAD ready"
            : staticAssetStatus === "failed"
              ? "Static RAD failed"
              : "Loading static RAD"}
        </p>
      )}
    </div>
  );
}

function getDynamicTransferLevels(
  sequence: DynamicGaussianSequence,
): readonly GaussianQualityLevel[] {
  const levels = [...(sequence.frames[0]?.qualityLevels ?? [])]
    .filter(
      (level): level is GaussianQualityLevel & { detailLevel: number } =>
        level.url !== undefined && level.detailLevel !== undefined,
    )
    .sort(
      (left, right) => left.detailLevel - right.detailLevel || left.level - right.level,
    );
  const minimumPlayableDetail =
    levels.find(({ minimumPlayable }) => minimumPlayable)?.detailLevel ?? 0;
  return levels.filter(({ detailLevel }) => detailLevel >= minimumPlayableDetail);
}
