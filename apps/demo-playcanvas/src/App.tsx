import { loadLocalDynamicSequence } from "@6g-path/gaussian-demo-support";
import { FrameRingBuffer, SequencePlaybackController } from "@6g-path/gaussian-player";
import {
  PLAYCANVAS_SOG_CODEC_ID,
  PlayCanvasGaussianRendererAdapter,
  RenderView,
  queryPlayCanvasImmersiveVrSupport,
} from "@6g-path/gaussian-renderer-playcanvas";
import { memo, useEffect, useRef, useState } from "react";

import { parseGsplatRenderConfiguration } from "./gsplatRenderConfiguration.js";
import { resolvePlayCanvasDemoSceneMode } from "./sceneConfiguration.js";
import { parseScenePosition, withScenePosition } from "./scenePosition.js";
import { readStaticLoadDiagnostics } from "./staticLoadDiagnostics.js";
import { parseStaticLodConfiguration } from "./staticLodConfiguration.js";
import { createStaticSceneTransform } from "./staticSceneTransform.js";
import { StreamingDiagnostics } from "./streamingDiagnostics.js";
import { WebglXrMirrorPresenter } from "./webglXrMirror.js";
import { XrPlaybackClock } from "./xrPlaybackClock.js";

import type { ScenePosition } from "./scenePosition.js";
import type { StaticLoadDiagnostics } from "./staticLoadDiagnostics.js";
import type {
  DiagnosticDistribution,
  StreamingDiagnosticsSnapshot,
} from "./streamingDiagnostics.js";
import type {
  WebglXrMirrorSourceLayout,
  WebglXrMirrorStats,
  WebglXrViewerPose,
} from "./webglXrMirror.js";
import type {
  FrameRingBufferSnapshot,
  FrameRingBufferTraceEvent,
  DynamicGaussianSequence,
  GaussianQualityLevel,
  PlayerLifecycleState,
} from "@6g-path/gaussian-player";
import type {
  PlayCanvasGraphicsBackend,
  PlayCanvasGpuTimingDistribution,
  PlayCanvasGpuTimingSnapshot,
  PlayCanvasRendererMetrics,
  PlayCanvasRendererRuntimeInfo,
} from "@6g-path/gaussian-renderer-playcanvas";

type RuntimeStatus = "initialising" | "ready" | "unavailable";
type StaticAssetStatus = "failed" | "loading" | "not configured" | "ready";
type XrStatus =
  | "disabled"
  | "initialising"
  | "ready"
  | "active"
  | "browser unavailable"
  | "session unsupported"
  | "webgpu binding missing"
  | "probe failed"
  | "unavailable";

interface LatestTimings {
  compressedFetchMs: number | undefined;
  framePreparationMs: number | undefined;
}

interface ScenePositionInputs {
  readonly x: string;
  readonly y: string;
  readonly z: string;
}

type ScenePositionAxis = keyof ScenePositionInputs;

const minimumDynamicSplatCount = 100;
const minimumDynamicTransferDetail = 0.25;
const staticGsUrl = import.meta.env.VITE_STATIC_GS_URL?.trim();
const sceneMode = resolvePlayCanvasDemoSceneMode({
  dynamicQualityIndexUrl: import.meta.env.VITE_DYNAMIC_QUALITY_INDEX_URL,
  staticGsUrl,
});
const dynamicSequenceConfigured = sceneMode === "dynamic-enabled";
const staticObjectId = "demo-static-sog";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function gpuTimingSampleInterval(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 2_000;
  }
  const parsed = Number(value);
  if (Number.isInteger(parsed) && (parsed === 0 || parsed >= 250)) {
    return parsed;
  }
  throw new Error(
    "VITE_PLAYCANVAS_GPU_TIMING_INTERVAL_MS must be zero or an integer of at least 250.",
  );
}

const compressedBufferMaximumBytes =
  positiveInteger(import.meta.env.VITE_DYNAMIC_COMPRESSED_BUFFER_MB, 200) * 1_000_000;
const preparationConcurrency = positiveInteger(
  import.meta.env.VITE_DYNAMIC_PREPARE_CONCURRENCY,
  2,
);
const fetchConcurrency = positiveInteger(
  import.meta.env.VITE_DYNAMIC_FETCH_CONCURRENCY,
  6,
);
const futureFrameCount = positiveInteger(
  import.meta.env.VITE_DYNAMIC_FUTURE_FRAMES,
  10,
);
const xrBackendFallbackEnabled =
  import.meta.env.VITE_PLAYCANVAS_XR_BACKEND_FALLBACK === "true";
const xrMirrorEnabled = import.meta.env.VITE_PLAYCANVAS_XR_MIRROR === "true";
const gpuTimingSampleIntervalMs = gpuTimingSampleInterval(
  import.meta.env.VITE_PLAYCANVAS_GPU_TIMING_INTERVAL_MS,
);
const staticGsBaseTransform = createStaticSceneTransform({
  rotationXDegrees: import.meta.env.VITE_STATIC_GS_ROTATION_X_DEGREES,
  scale: import.meta.env.VITE_STATIC_GS_SCALE,
});
const configuredStaticGsPosition = parseScenePosition({
  x: import.meta.env.VITE_STATIC_GS_POSITION_X,
  y: import.meta.env.VITE_STATIC_GS_POSITION_Y,
  z: import.meta.env.VITE_STATIC_GS_POSITION_Z,
});
const configuredDynamicGsPosition = parseScenePosition({
  x: import.meta.env.VITE_DYNAMIC_GS_POSITION_X,
  y: import.meta.env.VITE_DYNAMIC_GS_POSITION_Y,
  z: import.meta.env.VITE_DYNAMIC_GS_POSITION_Z,
});
const configuredStaticGsPositionInputs = scenePositionInputs(
  configuredStaticGsPosition,
);
const configuredDynamicGsPositionInputs = scenePositionInputs(
  configuredDynamicGsPosition,
);
const staticGsTransform = withScenePosition(
  staticGsBaseTransform,
  configuredStaticGsPosition,
);

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<PlayCanvasGaussianRendererAdapter | undefined>(undefined);
  const bufferRef = useRef<FrameRingBuffer | undefined>(undefined);
  const diagnosticsRef = useRef<StreamingDiagnostics | undefined>(undefined);
  const dynamicBaseTransformRef =
    useRef<DynamicGaussianSequence["transform"]>(undefined);
  const playbackRef = useRef<SequencePlaybackController | undefined>(undefined);
  const playbackClockRef = useRef<XrPlaybackClock | undefined>(undefined);
  const xrMirrorRef = useRef<WebglXrMirrorPresenter | undefined>(undefined);
  const [bufferSnapshot, setBufferSnapshot] = useState<FrameRingBufferSnapshot>();
  const [error, setError] = useState<string>();
  const [frameIndex, setFrameIndex] = useState(0);
  const [lifecycle, setLifecycle] = useState<PlayerLifecycleState>("IDLE");
  const [mirrorActive, setMirrorActive] = useState(false);
  const [mirrorStats, setMirrorStats] = useState<WebglXrMirrorStats>();
  const [metrics, setMetrics] = useState<PlayCanvasRendererMetrics>();
  const [qualityLevels, setQualityLevels] = useState<readonly GaussianQualityLevel[]>(
    [],
  );
  const [rendererRuntime, setRendererRuntime] =
    useState<PlayCanvasRendererRuntimeInfo>();
  const [staticGsPosition, setStaticGsPosition] = useState<ScenePositionInputs>(
    configuredStaticGsPositionInputs,
  );
  const [dynamicGsPosition, setDynamicGsPosition] = useState<ScenePositionInputs>(
    configuredDynamicGsPositionInputs,
  );
  const [selectedDetail, setSelectedDetail] = useState(0.25);
  const [staticAssetStatus, setStaticAssetStatus] = useState<StaticAssetStatus>(
    staticGsUrl === undefined || staticGsUrl.length === 0
      ? "not configured"
      : "loading",
  );
  const [staticLoadMetrics, setStaticLoadMetrics] = useState<StaticLoadDiagnostics>();
  const [staticLodLevel, setStaticLodLevel] = useState<number>();
  const [status, setStatus] = useState<RuntimeStatus>("initialising");
  const [splatBudget, setSplatBudget] = useState<number>();
  const [targetFramesPerSecond, setTargetFramesPerSecond] = useState<number>();
  const [streamingDiagnostics, setStreamingDiagnostics] =
    useState<StreamingDiagnosticsSnapshot>();
  const [timings, setTimings] = useState<LatestTimings>({
    compressedFetchMs: undefined,
    framePreparationMs: undefined,
  });
  const xrEnabled = import.meta.env.VITE_ENABLE_XR !== "false";
  const [xrStatus, setXrStatus] = useState<XrStatus>(
    xrEnabled ? "initialising" : "disabled",
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const targetCanvas = canvas;

    let active = true;
    let adapter: PlayCanvasGaussianRendererAdapter | undefined;
    let buffer: FrameRingBuffer | undefined;
    let playback: SequencePlaybackController | undefined;
    let unsubscribeBuffer: (() => void) | undefined;
    let unsubscribePlayback: (() => void) | undefined;
    const abortController = new AbortController();
    const diagnosticCollector = new StreamingDiagnostics(
      fetchConcurrency,
      preparationConcurrency,
    );
    diagnosticsRef.current = diagnosticCollector;
    diagnosticCollector.start();
    const playbackClock = new XrPlaybackClock();
    playbackClockRef.current = playbackClock;
    const latestTimings: LatestTimings = {
      compressedFetchMs: undefined,
      framePreparationMs: undefined,
    };
    const environment: Record<string, string | undefined> = {
      VITE_DYNAMIC_FRAME_CODEC: import.meta.env.VITE_DYNAMIC_FRAME_CODEC,
      VITE_DYNAMIC_QUALITY_INDEX_URL: import.meta.env.VITE_DYNAMIC_QUALITY_INDEX_URL,
      VITE_DYNAMIC_RAD_BASE_URL: import.meta.env.VITE_DYNAMIC_RAD_BASE_URL,
      VITE_DYNAMIC_RAD_END_FRAME: import.meta.env.VITE_DYNAMIC_RAD_END_FRAME,
      VITE_DYNAMIC_RAD_FRAME_RATE: import.meta.env.VITE_DYNAMIC_RAD_FRAME_RATE,
      VITE_DYNAMIC_RAD_START_FRAME: import.meta.env.VITE_DYNAMIC_RAD_START_FRAME,
    };
    let metricsTimer: number | undefined;

    function observeTrace(event: Readonly<FrameRingBufferTraceEvent>) {
      diagnosticCollector.observeTrace(event);
      if (event.type === "compressed-fetch-ready") {
        latestTimings.compressedFetchMs = event.durationMs;
      } else if (event.type === "base-ready") {
        latestTimings.framePreparationMs = event.durationMs;
      }
    }

    async function initialise() {
      try {
        const requestedGraphicsBackend = parseGraphicsBackend(
          import.meta.env.VITE_PLAYCANVAS_GRAPHICS_BACKEND,
        );
        const graphicsBackend = await selectGraphicsBackendForXr(
          requestedGraphicsBackend,
          xrEnabled,
        );
        if (graphicsBackend !== requestedGraphicsBackend) {
          console.info(
            `PlayCanvas selected ${graphicsBackend} because ${requestedGraphicsBackend} cannot host immersive-vr on this browser.`,
          );
        }
        if (sceneMode === "unconfigured") {
          throw new Error(
            "Configure VITE_STATIC_GS_URL, VITE_DYNAMIC_QUALITY_INDEX_URL, or both.",
          );
        }
        if (
          dynamicSequenceConfigured &&
          environment.VITE_DYNAMIC_FRAME_CODEC !== PLAYCANVAS_SOG_CODEC_ID
        ) {
          throw new Error(
            `The PlayCanvas comparison demo requires VITE_DYNAMIC_FRAME_CODEC=${PLAYCANVAS_SOG_CODEC_ID}.`,
          );
        }
        const staticLodConfiguration = parseStaticLodConfiguration({
          lodLevel: import.meta.env.VITE_STATIC_GS_LOD_LEVEL,
          splatBudget: import.meta.env.VITE_PLAYCANVAS_SPLAT_BUDGET,
        });
        const gsplatRenderConfiguration = parseGsplatRenderConfiguration({
          foveationCenter: import.meta.env.VITE_PLAYCANVAS_GSPLAT_FOVEATION_CENTER,
          foveationStrength: import.meta.env.VITE_PLAYCANVAS_GSPLAT_FOVEATION_STRENGTH,
          minContribution: import.meta.env.VITE_PLAYCANVAS_GSPLAT_MIN_CONTRIBUTION,
          minPixelSize: import.meta.env.VITE_PLAYCANVAS_GSPLAT_MIN_PIXEL_SIZE,
        });

        const initialisedAdapter = new PlayCanvasGaussianRendererAdapter({
          canvas: targetCanvas,
          gpuTimingSampleIntervalMs,
          graphicsBackend,
          ...gsplatRenderConfiguration,
          ...(staticLodConfiguration.splatBudget === undefined
            ? {}
            : { splatBudget: staticLodConfiguration.splatBudget }),
          ...(staticLodConfiguration.lodLevel === undefined
            ? {}
            : { staticLodLevel: staticLodConfiguration.lodLevel }),
        });
        adapter = initialisedAdapter;
        adapterRef.current = initialisedAdapter;
        await initialisedAdapter.initialise();
        if (active) {
          setRendererRuntime(initialisedAdapter.getRuntimeInfo());
          setSplatBudget(staticLodConfiguration.splatBudget);
          setStaticLodLevel(staticLodConfiguration.lodLevel);
        }
        if (staticGsUrl !== undefined && staticGsUrl.length > 0) {
          try {
            const staticLoadStartedAt = performance.now();
            let staticLoadedBytes: number | undefined;
            await initialisedAdapter.loadStaticObject(
              {
                id: staticObjectId,
                ...(staticGsTransform === undefined
                  ? {}
                  : { transform: staticGsTransform }),
                url: staticGsUrl,
              },
              {
                onProgress: ({ loadedBytes }) => {
                  staticLoadedBytes = Math.max(staticLoadedBytes ?? 0, loadedBytes);
                },
                signal: abortController.signal,
              },
            );
            if (active) {
              setStaticLoadMetrics(
                readStaticLoadDiagnostics({
                  completedAtMs: performance.now(),
                  ...(staticLoadedBytes === undefined
                    ? {}
                    : { loadedBytes: staticLoadedBytes }),
                  startedAtMs: staticLoadStartedAt,
                  url: staticGsUrl,
                }),
              );
              setStaticAssetStatus("ready");
            }
          } catch (caught) {
            if (active && !abortController.signal.aborted) {
              console.error("Unable to load the configured static SOG asset.", caught);
              setStaticAssetStatus("failed");
            }
          }
        }
        if (dynamicSequenceConfigured) {
          const sequence = await loadLocalDynamicSequence(environment, {
            signal: abortController.signal,
          });
          if (sequence === undefined) {
            throw new Error("The configured dynamic SOG sequence could not be loaded.");
          }
          dynamicBaseTransformRef.current = sequence.transform;
          const levels = collectTransferLevels(sequence.frames[0]?.qualityLevels ?? []);
          const initialDetail =
            levels.find(
              ({ detailLevel, minimumPlayable }) =>
                minimumPlayable === true &&
                (detailLevel ?? 0) >= minimumDynamicTransferDetail,
            )?.detailLevel ??
            levels.find(
              ({ detailLevel }) => (detailLevel ?? 0) >= minimumDynamicTransferDetail,
            )?.detailLevel ??
            levels.find(({ minimumPlayable }) => minimumPlayable)?.detailLevel ??
            levels[0]?.detailLevel ??
            minimumDynamicTransferDetail;
          if (active) {
            setQualityLevels(levels);
            setSelectedDetail(initialDetail);
          }

          buffer = new FrameRingBuffer({
            compressedBufferMaximumBytes,
            futureFrameCount: Math.min(futureFrameCount, sequence.frameCount - 1),
            loop: true,
            maximumBasePreparationConcurrency: preparationConcurrency,
            maximumCompressedFetchConcurrency: fetchConcurrency,
            maximumRefinementConcurrency: 1,
            onTrace: observeTrace,
            previousFrameCount: sequence.frameCount > 1 ? 1 : 0,
            presentationQualityTarget: {
              detailLevel: initialDetail,
              minimumSplatCount: minimumDynamicSplatCount,
            },
            renderer: initialisedAdapter,
            sequence,
          });
          bufferRef.current = buffer;
          buffer.setTransform(
            withScenePosition(sequence.transform, configuredDynamicGsPosition),
          );
          unsubscribeBuffer = buffer.subscribe((snapshot) => {
            if (active) {
              setBufferSnapshot(snapshot);
            }
          });
          await buffer.initialise(0);
          playback = new SequencePlaybackController({
            buffer,
            clock: playbackClock,
            loop: true,
            minimumReadyFrames: Math.min(2, buffer.snapshot.futureFrameCount),
            sequence,
          });
          playbackRef.current = playback;
          unsubscribePlayback = playback.subscribe((snapshot) => {
            diagnosticCollector.observePlayback(snapshot);
            if (!active) {
              return;
            }
            setFrameIndex(snapshot.currentFrameIndex);
            setLifecycle(snapshot.lifecycle);
            setTargetFramesPerSecond(snapshot.targetFramesPerSecond);
            if (snapshot.lifecycle === "ERROR") {
              setError(errorMessage(snapshot.error));
            }
          });
        }

        metricsTimer = window.setInterval(() => {
          if (!active) {
            return;
          }
          setMetrics(initialisedAdapter.getMetrics());
          setStreamingDiagnostics(diagnosticCollector.snapshot());
          setTimings({ ...latestTimings });
          if (xrEnabled) {
            void readXrStatus(initialisedAdapter)
              .then((nextStatus) => {
                if (active) {
                  setXrStatus(nextStatus);
                }
              })
              .catch((caught: unknown) => {
                if (active) {
                  setError(errorMessage(caught));
                  setXrStatus("unavailable");
                }
              });
          }
        }, 500);
        if (active) {
          setXrStatus(xrEnabled ? await readXrStatus(initialisedAdapter) : "disabled");
          setStatus("ready");
        }
      } catch (caught) {
        if (active && !abortController.signal.aborted) {
          console.error("PlayCanvas demo initialisation failed.", caught);
          setError(errorMessage(caught));
          setStatus("unavailable");
          if (xrEnabled) {
            setXrStatus("unavailable");
          }
        }
      }
    }

    void initialise();
    return () => {
      active = false;
      abortController.abort();
      diagnosticCollector.dispose();
      if (diagnosticsRef.current === diagnosticCollector) {
        diagnosticsRef.current = undefined;
      }
      if (metricsTimer !== undefined) {
        window.clearInterval(metricsTimer);
      }
      unsubscribePlayback?.();
      playback?.dispose();
      playbackRef.current = undefined;
      playbackClock.dispose();
      if (playbackClockRef.current === playbackClock) {
        playbackClockRef.current = undefined;
      }
      unsubscribeBuffer?.();
      buffer?.dispose();
      bufferRef.current = undefined;
      dynamicBaseTransformRef.current = undefined;
      adapter?.dispose();
      if (adapterRef.current === adapter) {
        adapterRef.current = undefined;
      }
      xrMirrorRef.current?.dispose();
      xrMirrorRef.current = undefined;
    };
  }, [xrEnabled]);

  function selectQuality(value: string) {
    const detailLevel = Number(value);
    playbackRef.current?.pause();
    bufferRef.current?.setPresentationQualityTarget({
      detailLevel,
      minimumSplatCount: minimumDynamicSplatCount,
    });
    setSelectedDetail(detailLevel);
  }

  function updateStaticGsPosition(axis: ScenePositionAxis, value: string) {
    const nextPosition = { ...staticGsPosition, [axis]: value };
    setStaticGsPosition(nextPosition);
    const parsedPosition = parseScenePositionInputs(nextPosition);
    if (parsedPosition === undefined || staticAssetStatus !== "ready") {
      return;
    }

    try {
      adapterRef.current?.setObjectTransform(
        staticObjectId,
        withScenePosition(staticGsBaseTransform, parsedPosition) ?? {},
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function resetStaticGsPosition() {
    setStaticGsPosition(configuredStaticGsPositionInputs);
    try {
      if (staticAssetStatus === "ready") {
        adapterRef.current?.setObjectTransform(staticObjectId, staticGsTransform ?? {});
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function updateDynamicGsPosition(axis: ScenePositionAxis, value: string) {
    const nextPosition = { ...dynamicGsPosition, [axis]: value };
    setDynamicGsPosition(nextPosition);
    const parsedPosition = parseScenePositionInputs(nextPosition);
    if (parsedPosition === undefined) {
      return;
    }

    try {
      bufferRef.current?.setTransform(
        withScenePosition(dynamicBaseTransformRef.current, parsedPosition),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function resetDynamicGsPosition() {
    setDynamicGsPosition(configuredDynamicGsPositionInputs);
    try {
      bufferRef.current?.setTransform(
        withScenePosition(dynamicBaseTransformRef.current, configuredDynamicGsPosition),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function step(delta: number) {
    playbackRef.current?.pause();
    void playbackRef.current?.step(delta).catch((caught: unknown) => {
      setError(errorMessage(caught));
    });
  }

  function togglePlayback() {
    const playback = playbackRef.current;
    if (playback === undefined) {
      return;
    }
    if (playback.snapshot.isPlaying) {
      playback.pause();
    } else {
      diagnosticsRef.current?.reset();
      playback.play();
    }
  }

  function toggleXr() {
    const adapter = adapterRef.current;
    if (adapter === undefined) {
      return;
    }
    const operation = adapter.isXrActive() ? adapter.endXr() : adapter.startXr();
    void operation
      .then(() => {
        setXrStatus(adapter.isXrActive() ? "active" : "ready");
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
        setXrStatus("unavailable");
      });
  }

  function toggleXrMirror() {
    const sourceCanvas = canvasRef.current;
    const adapter = adapterRef.current;
    if (sourceCanvas === null || adapter === undefined) {
      return;
    }
    const activeMirror = xrMirrorRef.current;
    if (activeMirror !== undefined && activeMirror.active) {
      void activeMirror.end().catch((caught: unknown) => {
        setError(errorMessage(caught));
      });
      return;
    }

    const application = adapter.application;
    const playbackClock = playbackClockRef.current;
    const cameraEntity = adapter.cameraEntity;
    const camera = cameraEntity.camera;
    if (camera === undefined) {
      setError("The PlayCanvas mirror camera is unavailable.");
      return;
    }
    const previousAutoRender = application.autoRender;
    const originalCanvasHeight = sourceCanvas.height;
    const originalCanvasWidth = sourceCanvas.width;
    const originalResolutionMode = application.resolutionMode;
    const originalCameraPosition = cameraEntity.getPosition().clone();
    const originalCameraRotation = cameraEntity.getRotation().clone();
    const originalCameraTransform = cameraEntity.getWorldTransform().clone();
    const originalCalculateProjection = camera.calculateProjection;
    const sceneCamera = camera.camera;
    const originalXrViews = sceneCamera.xrViews;
    const anchorTransform = originalCameraTransform.clone();
    const viewerTransform = originalCameraTransform.clone();
    const parentInverse = originalCameraTransform.clone().setIdentity();
    const localEyeTransform = originalCameraTransform.clone();
    const xrEyeTransform = originalCameraTransform.clone();
    const eyeWorldTransform = originalCameraTransform.clone();
    const viewerWorldTransform = originalCameraTransform.clone();
    const viewerPosition = originalCameraPosition.clone();
    const viewerRotation = originalCameraRotation.clone();
    const renderViews = {
      left: new RenderView(),
      right: new RenderView(),
    };
    let lastXrApplicationTime: number | undefined;
    let anchorInitialised = false;
    let sourceRestored = false;
    const restoreSource = () => {
      if (!sourceRestored) {
        application.autoRender = previousAutoRender;
        camera.calculateProjection = originalCalculateProjection;
        sceneCamera.xrViews = originalXrViews;
        cameraEntity.setPosition(originalCameraPosition);
        cameraEntity.setRotation(originalCameraRotation);
        if (originalResolutionMode === "AUTO") {
          application.setCanvasResolution(originalResolutionMode);
        } else {
          const pixelRatio = Math.min(
            application.graphicsDevice.maxPixelRatio,
            window.devicePixelRatio,
          );
          application.setCanvasResolution(
            originalResolutionMode,
            originalCanvasWidth / pixelRatio,
            originalCanvasHeight / pixelRatio,
          );
          application.graphicsDevice.setResolution(
            originalCanvasWidth,
            originalCanvasHeight,
          );
        }
        sourceRestored = true;
      }
    };
    const renderSourceFrame = (
      pose: WebglXrViewerPose,
      sourceLayout: WebglXrMirrorSourceLayout,
      time: number,
    ) => {
      if (!anchorInitialised) {
        viewerTransform.set(pose.transform.matrix as unknown as number[]).invert();
        anchorTransform.copy(originalCameraTransform).mul(viewerTransform);
        const parent = cameraEntity.parent;
        if (parent !== null) {
          parentInverse.copy(parent.getWorldTransform()).invert();
        }
        anchorInitialised = true;
      }

      const stereoViews = pose.views.filter(
        (view) => view.eye === "left" || view.eye === "right",
      );
      if (stereoViews.length !== 2) {
        throw new Error(
          `Expected two WebXR eye views, received ${stereoViews.length}.`,
        );
      }
      if (
        application.resolutionMode !== "FIXED" ||
        sourceCanvas.width !== sourceLayout.width ||
        sourceCanvas.height !== sourceLayout.height
      ) {
        // application.render() calls updateCanvasSize(). Keep the mirror resolution
        // fixed or RESOLUTION_AUTO immediately shrinks the packed XR viewports back to
        // the desktop CSS size, placing both views in one source region.
        const pixelRatio = Math.min(
          application.graphicsDevice.maxPixelRatio,
          window.devicePixelRatio,
        );
        application.setCanvasResolution(
          "FIXED",
          sourceLayout.width / pixelRatio,
          sourceLayout.height / pixelRatio,
        );
        application.graphicsDevice.setResolution(
          sourceLayout.width,
          sourceLayout.height,
        );
      }
      for (const view of stereoViews) {
        const renderView = renderViews[view.eye as "left" | "right"];
        const sourceView = sourceLayout.views.find(({ eye }) => eye === view.eye);
        if (sourceView === undefined) {
          throw new Error(
            `No packed source viewport exists for WebXR eye ${view.eye}.`,
          );
        }
        eyeWorldTransform
          .copy(anchorTransform)
          .mul(xrEyeTransform.set(view.transform.matrix as unknown as number[]));
        localEyeTransform.copy(parentInverse).mul(eyeWorldTransform);
        renderView.setView(view.projectionMatrix, localEyeTransform.data);
        renderView.setViewport(
          sourceView.x,
          sourceView.y,
          sourceView.width,
          sourceView.height,
        );
      }

      viewerWorldTransform
        .copy(anchorTransform)
        .mul(xrEyeTransform.set(pose.transform.matrix as unknown as number[]));
      viewerWorldTransform.getTranslation(viewerPosition);
      viewerRotation.setFromMat4(viewerWorldTransform);
      cameraEntity.setPosition(viewerPosition);
      cameraEntity.setRotation(viewerRotation);
      camera.calculateProjection = originalCalculateProjection;
      sceneCamera.xrViews = [renderViews.left, renderViews.right];
      const elapsedMs =
        lastXrApplicationTime === undefined
          ? 0
          : Math.max(0, time - lastXrApplicationTime);
      const deltaSeconds =
        Math.min(application.maxDeltaTime, elapsedMs / 1000) * application.timeScale;
      application.fire("frameupdate", elapsedMs);
      application.update(deltaSeconds);
      application.fire("framerender");
      application.render();
      application.renderNextFrame = false;
      application.fire("frameend");
      application.stats.frameEnd();
      lastXrApplicationTime = time;
    };
    const nextMirror = new WebglXrMirrorPresenter(sourceCanvas, {
      onEnd: () => {
        playbackClock?.exitXr();
        restoreSource();
        if (xrMirrorRef.current === nextMirror) {
          xrMirrorRef.current = undefined;
        }
        setMirrorActive(false);
      },
      onError: (caught) => {
        playbackClock?.exitXr();
        setError(errorMessage(caught));
        setMirrorActive(false);
      },
      onStats: setMirrorStats,
      onXrFrame: () => playbackClock?.tick(performance.now()),
      renderSourceFrame,
    });
    xrMirrorRef.current = nextMirror;
    application.autoRender = false;
    playbackClock?.enterXr();
    void nextMirror
      .start()
      .then(() => {
        setMirrorActive(true);
      })
      .catch((caught: unknown) => {
        playbackClock?.exitXr();
        restoreSource();
        nextMirror.dispose();
        if (xrMirrorRef.current === nextMirror) {
          xrMirrorRef.current = undefined;
        }
        setError(errorMessage(caught));
        setMirrorActive(false);
      });
  }

  const presentedFrame = bufferSnapshot?.frames.find(
    ({ frameIndex: bufferedIndex, status: frameStatus }) =>
      bufferedIndex === frameIndex && frameStatus === "presented",
  );
  const readyAhead = bufferSnapshot?.frames.filter(
    ({ frameIndex: bufferedIndex, status: frameStatus }) =>
      bufferedIndex !== frameIndex &&
      (frameStatus === "base-ready" ||
        frameStatus === "refining" ||
        frameStatus === "ready"),
  ).length;
  const selectedByteSize = qualityLevels.find(
    ({ detailLevel }) => detailLevel === selectedDetail,
  )?.byteSize;
  const requiredPayloadMbps =
    selectedByteSize === undefined || targetFramesPerSecond === undefined
      ? undefined
      : (selectedByteSize * 8 * targetFramesPerSecond) / 1_000_000;
  const deliveryMargin =
    requiredPayloadMbps === undefined ||
    requiredPayloadMbps <= 0 ||
    streamingDiagnostics?.aggregateFetchMbps === undefined
      ? undefined
      : streamingDiagnostics.aggregateFetchMbps / requiredPayloadMbps;
  const gpuTimings = metrics?.gpuTimings;

  return (
    <main>
      <header>
        <p className="eyebrow">Renderer comparison · SOG v2</p>
        <h1>PlayCanvas Gaussian Streaming</h1>
        <p>
          The renderer-neutral byte cache, rolling buffer, and playback clock feed
          native SOG assets directly to PlayCanvas.
        </p>
      </header>

      <section className="viewport-shell">
        <canvas ref={canvasRef} />
        <div className="renderer-badge">
          <span>PlayCanvas adapter</span>
          <strong>{status}</strong>
        </div>
        <section className="scene-position-controls" aria-label="Object positions">
          <PositionEditor
            disabled={status !== "ready" || staticAssetStatus !== "ready"}
            label="Static GS"
            position={staticGsPosition}
            onChange={updateStaticGsPosition}
            onReset={resetStaticGsPosition}
          />
          <PositionEditor
            disabled={status !== "ready" || !dynamicSequenceConfigured}
            label="Dynamic GS"
            position={dynamicGsPosition}
            onChange={updateDynamicGsPosition}
            onReset={resetDynamicGsPosition}
          />
          <small>
            Independent world offsets. Use Y to align either object vertically.
          </small>
        </section>
        <div className="controls">
          <button
            disabled={status !== "ready" || !dynamicSequenceConfigured}
            onClick={() => step(-1)}
          >
            Previous
          </button>
          <button
            disabled={status !== "ready" || !dynamicSequenceConfigured}
            onClick={togglePlayback}
          >
            {lifecycle === "PLAYING" || lifecycle === "BUFFERING" ? "Pause" : "Play"}
          </button>
          <button
            disabled={status !== "ready" || !dynamicSequenceConfigured}
            onClick={() => step(1)}
          >
            Next
          </button>
          <label>
            Transfer tier
            <select
              disabled={qualityLevels.length === 0}
              value={selectedDetail}
              onChange={(event) => selectQuality(event.currentTarget.value)}
            >
              {qualityLevels.map((level, index) => (
                <option
                  key={`${level.level}-${level.detailLevel}`}
                  value={level.detailLevel}
                >
                  {qualityLabel(level, index)}
                </option>
              ))}
            </select>
          </label>
          {xrEnabled ? (
            <button
              className="xr-button"
              disabled={xrStatus !== "ready" && xrStatus !== "active"}
              onClick={toggleXr}
            >
              {xrStatus === "active" ? "Exit VR" : "Enter VR"}
            </button>
          ) : null}
          {xrEnabled && xrMirrorEnabled ? (
            <button
              className="xr-button"
              disabled={
                status !== "ready" || rendererRuntime?.graphicsBackend !== "webgpu"
              }
              onClick={toggleXrMirror}
            >
              {mirrorActive ? "Exit mirror" : "XR mirror"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="status-grid">
        <Metric
          label="Lifecycle"
          value={dynamicSequenceConfigured ? lifecycle : "STATIC ONLY"}
        />
        <Metric label="Static SOG" value={staticAssetStatus} />
        <Metric
          label="Static LOD"
          value={
            staticLodLevel === undefined ? "automatic" : `${staticLodLevel} pinned`
          }
        />
        <Metric
          label="Splat budget"
          value={
            splatBudget === undefined || splatBudget === 0
              ? "unlimited"
              : formatCount(splatBudget)
          }
        />
        <Metric
          label="Frame"
          value={dynamicSequenceConfigured ? `${frameIndex + 1}` : "not configured"}
        />
        <Metric label="Prepared ahead" value={`${readyAhead ?? 0}`} />
        <Metric
          label="Byte cache"
          value={formatCache(bufferSnapshot?.compressedBuffer)}
        />
        <Metric
          label="Active splats"
          value={formatCount(metrics?.renderedSplatCount)}
        />
        <Metric label="Render FPS" value={formatRate(metrics?.renderFramesPerSecond)} />
        <Metric
          label="Latest SOG fetch"
          value={formatDuration(timings.compressedFetchMs)}
        />
        <Metric
          label="Latest SOG prepare"
          value={formatDuration(timings.framePreparationMs)}
        />
        <Metric
          label="Frame commit"
          value={formatDuration(metrics?.frameCommitTimeMs)}
        />
        <Metric label="Sort" value={formatDuration(metrics?.sortTimeMs)} />
        <Metric
          label="GS buffer copy"
          value={formatPercent(metrics?.workBufferCopyPercent)}
        />
        <Metric
          label="Presented tier"
          value={
            presentedFrame === undefined ? "waiting" : `${presentedFrame.qualityLevel}`
          }
        />
        <Metric
          label="Graphics"
          value={rendererRuntime?.graphicsBackend ?? "initialising"}
        />
        <Metric
          label="Sort path"
          value={
            rendererRuntime === undefined
              ? "initialising"
              : `${rendererRuntime.gaussianSort} (${
                  rendererRuntime.splatCentersEnabled ? "CPU centers" : "no CPU centers"
                })`
          }
        />
        <Metric label="WebXR" value={xrStatus} />
        {xrMirrorEnabled ? (
          <>
            <Metric label="XR mirror" value={mirrorActive ? "active" : "ready"} />
            <Metric
              label="Mirror FPS"
              value={formatRate(mirrorStats?.xrFramesPerSecond)}
            />
            <Metric
              label="Mirror copy"
              value={formatDuration(mirrorStats?.uploadAndDrawMs)}
            />
            <Metric
              label="Mirror render"
              value={formatDuration(mirrorStats?.sourceRenderMs)}
            />
            <Metric
              label="Mirror source"
              value={
                mirrorStats === undefined
                  ? "waiting"
                  : `${mirrorStats.sourceWidth} x ${mirrorStats.sourceHeight}`
              }
            />
            <Metric
              label="Mirror upload"
              value={mirrorStats?.uploadPath ?? "waiting"}
            />
            <Metric label="Mirror view" value={mirrorStats?.viewMode ?? "waiting"} />
          </>
        ) : null}
      </section>

      <GpuTimingPanel snapshot={gpuTimings} />

      {staticGsUrl === undefined || staticGsUrl.length === 0 ? null : (
        <>
          <div className="diagnostic-heading">
            <h2>Static scene load benchmark</h2>
            <p>
              One-shot delivery and native PlayCanvas processing for the linked asset.
            </p>
          </div>
          <section className="status-grid" aria-label="Static scene load benchmark">
            <Metric
              label="Payload"
              value={formatBytes(staticLoadMetrics?.loadedBytes)}
            />
            <Metric
              label="End-to-end throughput"
              value={formatMbps(staticLoadMetrics?.endToEndThroughputMbps)}
            />
            <Metric
              label="Body throughput"
              value={formatMbps(staticLoadMetrics?.bodyThroughputMbps)}
            />
            <Metric
              label="Total load"
              value={formatDuration(staticLoadMetrics?.totalLoadMs)}
            />
            <Metric
              label="Network delivery"
              value={formatDuration(staticLoadMetrics?.networkTimeMs)}
            />
            <Metric
              label="Native processing"
              value={formatDuration(staticLoadMetrics?.nativeProcessingMs)}
            />
            <Metric
              label="Response latency"
              value={formatDuration(staticLoadMetrics?.responseLatencyMs)}
            />
            <Metric
              label="Network protocol"
              value={staticLoadMetrics?.networkProtocol ?? "waiting"}
            />
            <Metric
              label="Connection setup"
              value={formatDuration(staticLoadMetrics?.connectionSetupMs)}
            />
            <Metric
              label="Connection reused"
              value={formatBoolean(staticLoadMetrics?.connectionReused)}
            />
            <Metric
              label="Delivery source"
              value={staticLoadMetrics?.cacheStatus ?? "waiting"}
            />
            <Metric
              label="Wire transfer"
              value={formatBytes(staticLoadMetrics?.transferredBytes)}
            />
          </section>
        </>
      )}

      <div className="diagnostic-heading">
        <h2>Streaming bottleneck diagnostics</h2>
        <p>
          Rolling p50 / p95 over the latest 120 samples; measurements reset when
          playback starts.
        </p>
      </div>
      <section className="status-grid" aria-label="Streaming bottleneck diagnostics">
        <Metric
          label="Aggregate fetch"
          value={formatMbps(streamingDiagnostics?.aggregateFetchMbps)}
        />
        <Metric label="Required payload" value={formatMbps(requiredPayloadMbps)} />
        <Metric label="Delivery margin" value={formatRatio(deliveryMargin)} />
        <Metric
          label="Network protocol"
          value={streamingDiagnostics?.networkProtocol ?? "unavailable"}
        />
        <Metric
          label="Connection setup"
          value={formatDistribution(streamingDiagnostics?.connectionSetup, "ms")}
        />
        <Metric
          label="New connections"
          value={`${streamingDiagnostics?.newConnectionCount ?? 0}`}
        />
        <Metric
          label="Body throughput"
          value={formatDistribution(streamingDiagnostics?.requestMbps, "Mbps")}
        />
        <Metric
          label="Response latency"
          value={formatDistribution(streamingDiagnostics?.responseLatency, "ms")}
        />
        <Metric
          label="Body + ArrayBuffer"
          value={formatDistribution(streamingDiagnostics?.bodyRead, "ms")}
        />
        <Metric
          label="Fetch total"
          value={formatDistribution(streamingDiagnostics?.totalFetch, "ms")}
        />
        <Metric
          label="Fetch slots"
          value={formatSlots(
            bufferSnapshot?.compressedBuffer?.activeFetchCount,
            streamingDiagnostics?.configuredFetchConcurrency,
          )}
        />
        <Metric
          label="Fetch queued"
          value={`${bufferSnapshot?.compressedBuffer?.queuedFetchCount ?? 0}`}
        />
        <Metric
          label="Cached contiguous"
          value={`${bufferSnapshot?.compressedBuffer?.contiguousReadyFrameCount ?? 0} / ${
            bufferSnapshot?.compressedBuffer?.readyFrameCount ?? 0
          } frames`}
        />
        <Metric
          label="Fetches / cache hits"
          value={`${streamingDiagnostics?.completedFetchCount ?? 0} / ${
            streamingDiagnostics?.cacheHitCount ?? 0
          }`}
        />
        <Metric
          label="Preparation queue"
          value={formatDistribution(streamingDiagnostics?.preparationQueue, "ms")}
        />
        <Metric
          label="Native SOG load"
          value={formatDistribution(streamingDiagnostics?.sogAssetLoad, "ms")}
        />
        <Metric
          label="End-to-end prepare"
          value={formatDistribution(streamingDiagnostics?.basePreparation, "ms")}
        />
        <Metric
          label="Prepare slots"
          value={formatSlots(
            bufferSnapshot?.activeBasePreparationCount,
            streamingDiagnostics?.configuredPreparationConcurrency,
          )}
        />
        <Metric
          label="Prepare queued"
          value={`${bufferSnapshot?.queuedBasePreparationCount ?? 0}`}
        />
        <Metric
          label="Presentation FPS"
          value={formatRate(streamingDiagnostics?.presentationFramesPerSecond)}
        />
        <Metric
          label="Buffering episodes"
          value={`${streamingDiagnostics?.stallCount ?? 0} / ${formatDuration(
            streamingDiagnostics?.stallTimeMs,
          )}`}
        />
        <Metric
          label="Dropped frames"
          value={`${streamingDiagnostics?.droppedFrameCount ?? 0}`}
        />
        <Metric
          label="Event-loop lag"
          value={formatDistribution(streamingDiagnostics?.eventLoopLag, "ms")}
        />
        <Metric label="Long tasks" value={formatLongTasks(streamingDiagnostics)} />
        <Metric
          label="Logical CPU / slots"
          value={`${streamingDiagnostics?.hardwareConcurrency ?? "unknown"} / ${
            streamingDiagnostics?.configuredPreparationConcurrency ??
            preparationConcurrency
          }`}
        />
        <Metric label="SOG worker pool" value="none (native async)" />
      </section>

      {error === undefined ? null : <p className="error">{error}</p>}
      <footer>
        Orbit with drag and zoom with the wheel. Enter VR appears when PlayCanvas
        detects an immersive-vr session on a secure origin.
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const GpuTimingPanel = memo(function GpuTimingPanel({
  snapshot,
}: {
  snapshot: PlayCanvasGpuTimingSnapshot | undefined;
}) {
  return (
    <>
      <div className="diagnostic-heading">
        <h2>GPU timing sampler</h2>
        <p>
          WebGPU timestamps on two frames per sampling interval; rolling p50 / p95 over
          the latest 60 captured frames. Passes are ordered by p95 GPU time.
        </p>
      </div>
      <section className="status-grid" aria-label="GPU timing summary">
        <Metric label="GPU timing" value={formatGpuTimingStatus(snapshot)} />
        <Metric
          label="GPU frame p50 / p95"
          value={formatGpuTimingDistribution(snapshot?.frameTime)}
        />
        <Metric
          label="GPU frame latest / max"
          value={formatGpuTimingLatestMax(snapshot?.frameTime)}
        />
        <Metric
          label="Captured frames"
          value={`${snapshot?.capturedFrameCount ?? 0}`}
        />
        <Metric label="Sampling" value={formatGpuSampling(snapshot)} />
      </section>
      {snapshot === undefined || snapshot.passTimings.length === 0 ? null : (
        <div className="gpu-timing-table-shell">
          <table className="gpu-timing-table">
            <thead>
              <tr>
                <th scope="col">GPU pass</th>
                <th scope="col">Latest</th>
                <th scope="col">p50</th>
                <th scope="col">p95</th>
                <th scope="col">Max</th>
                <th scope="col">Samples</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.passTimings.map((pass) => (
                <tr key={pass.name}>
                  <th scope="row">{pass.name}</th>
                  <td>{pass.latestMs.toFixed(2)} ms</td>
                  <td>{pass.p50Ms.toFixed(2)} ms</td>
                  <td>{pass.p95Ms.toFixed(2)} ms</td>
                  <td>{pass.maxMs.toFixed(2)} ms</td>
                  <td>{pass.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
});

function PositionEditor({
  disabled,
  label,
  position,
  onChange,
  onReset,
}: {
  disabled: boolean;
  label: string;
  position: ScenePositionInputs;
  onChange: (axis: ScenePositionAxis, value: string) => void;
  onReset: () => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>{label}</legend>
      <div className="scene-position-heading">
        <span>World offset</span>
        <button type="button" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="scene-position-grid">
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis}>
            {axis.toUpperCase()}
            <input
              aria-invalid={position[axis].trim() === ""}
              inputMode="decimal"
              step="0.1"
              type="number"
              value={position[axis]}
              onChange={(event) => onChange(axis, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function collectTransferLevels(
  levels: readonly GaussianQualityLevel[],
): readonly GaussianQualityLevel[] {
  return [...levels].sort(
    (left, right) => (left.detailLevel ?? 0) - (right.detailLevel ?? 0),
  );
}

function scenePositionInputs(position: ScenePosition): ScenePositionInputs {
  return {
    x: String(position.x),
    y: String(position.y),
    z: String(position.z),
  };
}

function parseScenePositionInputs(
  position: ScenePositionInputs,
): ScenePosition | undefined {
  if (Object.values(position).some((value) => value.trim() === "")) {
    return undefined;
  }
  const parsed = {
    x: Number(position.x),
    y: Number(position.y),
    z: Number(position.z),
  };
  return Object.values(parsed).every(Number.isFinite) ? parsed : undefined;
}

function qualityLabel(level: GaussianQualityLevel, index: number): string {
  const name =
    typeof level.metadata?.tier === "string" ? level.metadata.tier : undefined;
  const percentage = Math.round((level.detailLevel ?? 0) * 100);
  const splats =
    typeof level.splatCount === "number"
      ? ` · ${Math.round(level.splatCount).toLocaleString()} splats`
      : "";
  return `${name ?? `Tier ${index + 1}`} · ${percentage}%${splats}`;
}

function formatCache(snapshot: FrameRingBufferSnapshot["compressedBuffer"]): string {
  if (snapshot === undefined) {
    return "disabled";
  }
  return `${Math.round(snapshot.residentBytes / 1_000_000)} / ${Math.round(
    snapshot.capacityBytes / 1_000_000,
  )} MB`;
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "waiting" : Math.round(value).toLocaleString();
}

function formatBytes(value: number | undefined): string {
  return value === undefined ? "waiting" : `${(value / 1_000_000).toFixed(1)} MB`;
}

function formatBoolean(value: boolean | undefined): string {
  return value === undefined ? "waiting" : value ? "yes" : "no";
}

function formatDuration(value: number | undefined): string {
  return value === undefined ? "waiting" : `${value.toFixed(1)} ms`;
}

function formatGpuTimingDistribution(
  distribution: PlayCanvasGpuTimingDistribution | undefined,
): string {
  return distribution === undefined
    ? "waiting"
    : `${distribution.p50Ms.toFixed(2)} / ${distribution.p95Ms.toFixed(2)} ms`;
}

function formatGpuTimingLatestMax(
  distribution: PlayCanvasGpuTimingDistribution | undefined,
): string {
  return distribution === undefined
    ? "waiting"
    : `${distribution.latestMs.toFixed(2)} / ${distribution.maxMs.toFixed(2)} ms`;
}

function formatGpuTimingStatus(
  snapshot: PlayCanvasGpuTimingSnapshot | undefined,
): string {
  if (snapshot === undefined) {
    return "initialising";
  }
  if (snapshot.status === "unsupported") {
    return snapshot.reason ?? "unsupported";
  }
  return snapshot.status;
}

function formatGpuSampling(snapshot: PlayCanvasGpuTimingSnapshot | undefined): string {
  if (snapshot === undefined) {
    return "initialising";
  }
  if (snapshot.sampleIntervalMs === 0) {
    return "off";
  }
  return `${snapshot.captureFrameCount} frames / ${(
    snapshot.sampleIntervalMs / 1_000
  ).toFixed(1)} s`;
}

function formatRate(value: number | undefined): string {
  return value === undefined ? "waiting" : `${value.toFixed(1)} fps`;
}

function formatDistribution(
  distribution: DiagnosticDistribution | undefined,
  unit: string,
): string {
  if (distribution?.p50 === undefined || distribution.p95 === undefined) {
    return "waiting";
  }
  return `${distribution.p50.toFixed(1)} / ${distribution.p95.toFixed(1)} ${unit}`;
}

function formatMbps(value: number | undefined): string {
  return value === undefined ? "waiting" : `${value.toFixed(1)} Mbps`;
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "waiting" : `${value.toFixed(2)} x`;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "waiting" : `${value.toFixed(1)}%`;
}

function formatSlots(active: number | undefined, maximum: number | undefined): string {
  return `${active ?? 0} / ${maximum ?? "unknown"}`;
}

function formatLongTasks(snapshot: StreamingDiagnosticsSnapshot | undefined): string {
  if (snapshot === undefined) {
    return "waiting";
  }
  if (!snapshot.longTaskSupported) {
    return "API unavailable";
  }
  return `${snapshot.longTaskCount} / ${snapshot.longTaskTimeMs.toFixed(1)} ms`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function selectGraphicsBackendForXr(
  requestedGraphicsBackend: PlayCanvasGraphicsBackend,
  xrEnabled: boolean,
): Promise<PlayCanvasGraphicsBackend> {
  if (
    !xrEnabled ||
    !xrBackendFallbackEnabled ||
    requestedGraphicsBackend !== "webgpu"
  ) {
    return requestedGraphicsBackend;
  }
  const requestedSupport = await queryPlayCanvasImmersiveVrSupport(
    requestedGraphicsBackend,
  );
  if (requestedSupport.available) {
    return requestedGraphicsBackend;
  }
  const webglSupport = await queryPlayCanvasImmersiveVrSupport("webgl2");
  return webglSupport.available ? "webgl2" : requestedGraphicsBackend;
}

async function readXrStatus(
  adapter: PlayCanvasGaussianRendererAdapter,
): Promise<XrStatus> {
  if (adapter.isXrActive()) {
    return "active";
  }
  if (adapter.isXrAvailable()) {
    return "ready";
  }
  const support = await adapter.getXrSupportInfo();
  if (support.available) {
    return "ready";
  }
  switch (support.reason) {
    case "navigator-unavailable":
      return "browser unavailable";
    case "session-unsupported":
      return "session unsupported";
    case "webgpu-binding-unavailable":
      return "webgpu binding missing";
    case "probe-failed":
      return "probe failed";
    case "available":
      return "unavailable";
  }
}

function parseGraphicsBackend(value: string | undefined): PlayCanvasGraphicsBackend {
  if (value === undefined || value.trim() === "" || value === "webgl2") {
    return "webgl2";
  }
  if (value === "webgpu") {
    return value;
  }
  throw new Error(
    "VITE_PLAYCANVAS_GRAPHICS_BACKEND must be either 'webgl2' or 'webgpu'.",
  );
}
