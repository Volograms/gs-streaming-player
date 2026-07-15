import { FrameRingBuffer } from "@6g-path/gaussian-player";
import {
  cloneSparkRenderQuality,
  DEFAULT_SPARK_RENDER_QUALITY,
  SparkGaussianRendererAdapter,
} from "@6g-path/gaussian-renderer-spark";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { DynamicSequenceControls } from "./DynamicSequenceControls.js";
import { createLocalDynamicSequence } from "./localDynamicSequence.js";
import { RendererMetricsOverlay } from "./RendererMetricsOverlay.js";
import { CAPTURE_TO_THREE_TRANSFORM } from "./sceneCoordinates.js";
import { SparkQualityControls } from "./SparkQualityControls.js";

import type { RendererMetrics } from "@6g-path/gaussian-player";
import type { SparkRenderQualityConfiguration } from "@6g-path/gaussian-renderer-spark";

type RendererStatus = "initialising" | "ready" | "unavailable";
type StaticAssetStatus = "failed" | "loading" | "not-configured" | "ready";
type DynamicAssetStatus = "failed" | "loading" | "not-configured" | "ready";

const staticRadUrl = import.meta.env.VITE_STATIC_RAD_URL;
const dynamicSequence = createLocalDynamicSequence(import.meta.env);

function createInitialQuality(): SparkRenderQualityConfiguration {
  return {
    ...cloneSparkRenderQuality(DEFAULT_SPARK_RENDER_QUALITY),
    dynamicSequenceWeights: { actor: 1 },
    splatBudget: 1_500_000,
  };
}

export function SparkViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<SparkGaussianRendererAdapter | null>(null);
  const bufferRef = useRef<FrameRingBuffer | null>(null);
  const dynamicSwitchingRef = useRef(false);
  const [dynamicAssetStatus, setDynamicAssetStatus] = useState<DynamicAssetStatus>(
    dynamicSequence === undefined ? "not-configured" : "loading",
  );
  const [dynamicFrameIndex, setDynamicFrameIndex] = useState(0);
  const [isDynamicPlaying, setIsDynamicPlaying] = useState(false);
  const [isDynamicSwitching, setIsDynamicSwitching] = useState(false);
  const [metrics, setMetrics] = useState<RendererMetrics>();
  const [preparedFrameCount, setPreparedFrameCount] = useState(0);
  const [quality, setQuality] = useState(createInitialQuality);
  const qualityRef = useRef(quality);
  const [status, setStatus] = useState<RendererStatus>("initialising");
  const [staticAssetStatus, setStaticAssetStatus] = useState<StaticAssetStatus>(
    staticRadUrl === undefined ? "not-configured" : "loading",
  );

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
    const controller = new AbortController();
    const adapter = new SparkGaussianRendererAdapter({ autoRender: false, canvas });

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
            setMetrics(adapter.getMetrics());
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

        if (dynamicSequence !== undefined) {
          const buffer = new FrameRingBuffer({
            futureFrameCount: 3,
            loop: true,
            previousFrameCount: 1,
            renderer: adapter,
            sequence: dynamicSequence,
          });
          bufferRef.current = buffer;
          unsubscribeBuffer = buffer.subscribe(({ frames }) => {
            if (active) {
              setPreparedFrameCount(
                frames.filter(
                  ({ status }) => status !== "loading-base" && status !== "failed",
                ).length,
              );
            }
          });
          try {
            await buffer.initialise(0);
            if (active) {
              setDynamicAssetStatus("ready");
            }
          } catch (error) {
            buffer.dispose();
            if (bufferRef.current === buffer) {
              bufferRef.current = null;
            }
            if (active && !controller.signal.aborted) {
              console.error(
                "Unable to load the configured dynamic RAD sequence.",
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
      dynamicSwitchingRef.current = false;
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

  const presentDynamicFrame = useCallback(async (frameIndex: number) => {
    const buffer = bufferRef.current;
    if (buffer === null || dynamicSwitchingRef.current) {
      return;
    }
    dynamicSwitchingRef.current = true;
    setIsDynamicSwitching(true);
    try {
      await buffer.present(frameIndex);
      if (bufferRef.current === buffer) {
        setDynamicFrameIndex(frameIndex);
      }
    } catch (error) {
      if (bufferRef.current === buffer) {
        console.error("Unable to present the requested dynamic RAD frame.", error);
        setDynamicAssetStatus("failed");
        setIsDynamicPlaying(false);
      }
    } finally {
      if (bufferRef.current === buffer) {
        dynamicSwitchingRef.current = false;
        setIsDynamicSwitching(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isDynamicPlaying || dynamicAssetStatus !== "ready") {
      return;
    }
    const sequence = dynamicSequence;
    if (sequence === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!dynamicSwitchingRef.current) {
        void presentDynamicFrame((dynamicFrameIndex + 1) % sequence.frameCount);
      }
    }, 1000 / sequence.frameRate);
    return () => window.clearInterval(timer);
  }, [dynamicAssetStatus, dynamicFrameIndex, isDynamicPlaying, presentDynamicFrame]);

  function updateQuality(configuration: SparkRenderQualityConfiguration) {
    qualityRef.current = configuration;
    setQuality(configuration);
    adapterRef.current?.setSparkRenderQuality(configuration);
  }

  function stepDynamicFrame(delta: number) {
    setIsDynamicPlaying(false);
    const frameCount = dynamicSequence?.frameCount ?? 0;
    if (frameCount > 0) {
      void presentDynamicFrame((dynamicFrameIndex + delta + frameCount) % frameCount);
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
      <SparkQualityControls
        configuration={quality}
        disabled={status !== "ready"}
        onChange={updateQuality}
      />
      <RendererMetricsOverlay metrics={metrics} />
      {dynamicSequence === undefined ||
      dynamicAssetStatus === "not-configured" ? null : (
        <DynamicSequenceControls
          disabled={dynamicAssetStatus !== "ready" || isDynamicSwitching}
          frameCount={dynamicSequence.frameCount}
          frameIndex={dynamicFrameIndex}
          isPlaying={isDynamicPlaying}
          onNext={() => stepDynamicFrame(1)}
          onPlayPause={() => setIsDynamicPlaying((playing) => !playing)}
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
