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
  FrameRingBufferTraceEvent,
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
const dynamicSequenceId = "local-dynamic-sequence";
const minimumDynamicSplatCount = 100;

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
  const [dynamicFrameIndex, setDynamicFrameIndex] = useState(0);
  const [isDynamicPlaying, setIsDynamicPlaying] = useState(false);
  const [dynamicPlaybackLifecycle, setDynamicPlaybackLifecycle] =
    useState<PlayerLifecycleState>("IDLE");
  const [metrics, setMetrics] = useState<RendererMetrics>();
  const [preparedFrameCount, setPreparedFrameCount] = useState(0);
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
    const adapter = new SparkGaussianRendererAdapter({ autoRender: false, canvas });
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
              const decision = qualityController.update(
                {
                  bufferAheadSeconds:
                    playbackSnapshot.bufferAheadFrames / dynamicSequence.frameRate,
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
                    playbackSnapshot.bufferAheadFrames /
                    Math.max(1, buffer.snapshot.futureFrameCount),
                  downloadedBytes: buffer.snapshot.frames.reduce(
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
                detailLevel: decision.dynamicFrameDetailLevel ?? 0.25,
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
          qualityController = new BufferAwareQualityController({
            dynamicObjectId: loadedDynamicSequence.id,
            minimumSplatCount: minimumDynamicSplatCount,
            targetBufferSeconds: 2 / loadedDynamicSequence.frameRate,
          });
          const dynamicSequence = loadedDynamicSequence;
          const buffer = new FrameRingBuffer({
            futureFrameCount: 3,
            loop: true,
            maximumBasePreparationConcurrency: 2,
            maximumRefinementConcurrency: 1,
            onTrace: (event) => {
              if (
                event.type === "renderer-phase" &&
                event.phase === "minimum-renderable" &&
                event.durationMs !== undefined &&
                event.quality?.loadedBytes !== undefined
              ) {
                latestBaseFrameBytes = event.quality.loadedBytes;
                throughputEstimator.observe(
                  event.quality.loadedBytes,
                  event.durationMs,
                  event.atMs,
                );
              }
              bufferTraceListenerRef.current?.(event);
            },
            previousFrameCount: 1,
            presentationQualityTarget: {
              detailLevel: 0.25,
              minimumSplatCount: minimumDynamicSplatCount,
            },
            renderer: adapter,
            sequence: dynamicSequence,
          });
          bufferRef.current = buffer;
          unsubscribeBuffer = buffer.subscribe(({ frames }) => {
            if (active) {
              setPreparedFrameCount(
                frames.filter(
                  ({ status }) => status === "ready" || status === "presented",
                ).length,
              );
            }
          });
          try {
            await buffer.initialise(0);
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
          onAdaptiveChange={setAdaptiveQualityEnabled}
          onChange={updateQuality}
        />
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
      <RendererMetricsOverlay metrics={metrics} />
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
