import { loadLocalDynamicSequence } from "@6g-path/gaussian-demo-support";
import { FrameRingBuffer, SequencePlaybackController } from "@6g-path/gaussian-player";
import {
  PLAYCANVAS_SOG_CODEC_ID,
  PlayCanvasGaussianRendererAdapter,
} from "@6g-path/gaussian-renderer-playcanvas";
import { useEffect, useRef, useState } from "react";

import type {
  FrameRingBufferSnapshot,
  FrameRingBufferTraceEvent,
  GaussianQualityLevel,
  PlayerLifecycleState,
  RendererMetrics,
} from "@6g-path/gaussian-player";

type RuntimeStatus = "initialising" | "ready" | "unavailable";
type XrStatus = "disabled" | "initialising" | "ready" | "active" | "unavailable";

interface LatestTimings {
  compressedFetchMs: number | undefined;
  framePreparationMs: number | undefined;
}

const minimumDynamicSplatCount = 100;
const minimumDynamicTransferDetail = 0.25;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<PlayCanvasGaussianRendererAdapter | undefined>(undefined);
  const bufferRef = useRef<FrameRingBuffer | undefined>(undefined);
  const playbackRef = useRef<SequencePlaybackController | undefined>(undefined);
  const [bufferSnapshot, setBufferSnapshot] = useState<FrameRingBufferSnapshot>();
  const [error, setError] = useState<string>();
  const [frameIndex, setFrameIndex] = useState(0);
  const [lifecycle, setLifecycle] = useState<PlayerLifecycleState>("IDLE");
  const [metrics, setMetrics] = useState<RendererMetrics>();
  const [qualityLevels, setQualityLevels] = useState<readonly GaussianQualityLevel[]>(
    [],
  );
  const [selectedDetail, setSelectedDetail] = useState(0.25);
  const [status, setStatus] = useState<RuntimeStatus>("initialising");
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

    let active = true;
    let buffer: FrameRingBuffer | undefined;
    let playback: SequencePlaybackController | undefined;
    let unsubscribeBuffer: (() => void) | undefined;
    let unsubscribePlayback: (() => void) | undefined;
    const abortController = new AbortController();
    const latestTimings: LatestTimings = {
      compressedFetchMs: undefined,
      framePreparationMs: undefined,
    };
    const adapter = new PlayCanvasGaussianRendererAdapter({ canvas });
    adapterRef.current = adapter;
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
      if (event.type === "compressed-fetch-ready") {
        latestTimings.compressedFetchMs = event.durationMs;
      } else if (event.type === "base-ready") {
        latestTimings.framePreparationMs = event.durationMs;
      }
    }

    async function initialise() {
      try {
        if (
          environment.VITE_DYNAMIC_QUALITY_INDEX_URL === undefined ||
          environment.VITE_DYNAMIC_QUALITY_INDEX_URL.trim() === ""
        ) {
          throw new Error(
            "Configure VITE_DYNAMIC_QUALITY_INDEX_URL with the SOG v2 quality-cuts index.",
          );
        }
        if (environment.VITE_DYNAMIC_FRAME_CODEC !== PLAYCANVAS_SOG_CODEC_ID) {
          throw new Error(
            `The PlayCanvas comparison demo requires VITE_DYNAMIC_FRAME_CODEC=${PLAYCANVAS_SOG_CODEC_ID}.`,
          );
        }

        await adapter.initialise();
        const sequence = await loadLocalDynamicSequence(environment, {
          signal: abortController.signal,
        });
        if (sequence === undefined) {
          throw new Error("The dynamic SOG sequence is not configured.");
        }
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
          renderer: adapter,
          sequence,
        });
        bufferRef.current = buffer;
        unsubscribeBuffer = buffer.subscribe((snapshot) => {
          if (active) {
            setBufferSnapshot(snapshot);
          }
        });
        await buffer.initialise(0);
        playback = new SequencePlaybackController({
          buffer,
          loop: true,
          minimumReadyFrames: Math.min(2, buffer.snapshot.futureFrameCount),
          sequence,
        });
        playbackRef.current = playback;
        unsubscribePlayback = playback.subscribe((snapshot) => {
          if (!active) {
            return;
          }
          setFrameIndex(snapshot.currentFrameIndex);
          setLifecycle(snapshot.lifecycle);
          if (snapshot.lifecycle === "ERROR") {
            setError(errorMessage(snapshot.error));
          }
        });

        metricsTimer = window.setInterval(() => {
          if (!active) {
            return;
          }
          setMetrics(adapter.getMetrics());
          setTimings({ ...latestTimings });
          if (xrEnabled) {
            setXrStatus(
              adapter.isXrActive()
                ? "active"
                : adapter.isXrAvailable()
                  ? "ready"
                  : "unavailable",
            );
          }
        }, 500);
        if (active) {
          setXrStatus(
            xrEnabled
              ? adapter.isXrAvailable()
                ? "ready"
                : "unavailable"
              : "disabled",
          );
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
      if (metricsTimer !== undefined) {
        window.clearInterval(metricsTimer);
      }
      unsubscribePlayback?.();
      playback?.dispose();
      playbackRef.current = undefined;
      unsubscribeBuffer?.();
      buffer?.dispose();
      bufferRef.current = undefined;
      adapter.dispose();
      adapterRef.current = undefined;
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
        <div className="controls">
          <button disabled={status !== "ready"} onClick={() => step(-1)}>
            Previous
          </button>
          <button disabled={status !== "ready"} onClick={togglePlayback}>
            {lifecycle === "PLAYING" || lifecycle === "BUFFERING" ? "Pause" : "Play"}
          </button>
          <button disabled={status !== "ready"} onClick={() => step(1)}>
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
        </div>
      </section>

      <section className="status-grid">
        <Metric label="Lifecycle" value={lifecycle} />
        <Metric label="Frame" value={`${frameIndex + 1}`} />
        <Metric label="Prepared ahead" value={`${readyAhead ?? 0}`} />
        <Metric
          label="Byte cache"
          value={formatCache(bufferSnapshot?.compressedBuffer)}
        />
        <Metric
          label="Rendered splats"
          value={formatCount(metrics?.renderedSplatCount)}
        />
        <Metric label="Render FPS" value={formatRate(metrics?.renderFramesPerSecond)} />
        <Metric label="SOG fetch" value={formatDuration(timings.compressedFetchMs)} />
        <Metric
          label="SOG prepare"
          value={formatDuration(timings.framePreparationMs)}
        />
        <Metric
          label="Frame commit"
          value={formatDuration(metrics?.frameCommitTimeMs)}
        />
        <Metric label="Sort" value={formatDuration(metrics?.sortTimeMs)} />
        <Metric
          label="Presented tier"
          value={
            presentedFrame === undefined ? "waiting" : `${presentedFrame.qualityLevel}`
          }
        />
        <Metric label="WebXR" value={xrStatus} />
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

function collectTransferLevels(
  levels: readonly GaussianQualityLevel[],
): readonly GaussianQualityLevel[] {
  return [...levels].sort(
    (left, right) => (left.detailLevel ?? 0) - (right.detailLevel ?? 0),
  );
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

function formatDuration(value: number | undefined): string {
  return value === undefined ? "waiting" : `${value.toFixed(1)} ms`;
}

function formatRate(value: number | undefined): string {
  return value === undefined ? "waiting" : `${value.toFixed(1)} fps`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
