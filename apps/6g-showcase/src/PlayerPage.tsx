import { GaussianStreamingPlayer } from "@6g-path/gaussian-player";
import {
  PlayCanvasGaussianRendererAdapter,
  queryPlayCanvasImmersiveVrSupport,
} from "@6g-path/gaussian-renderer-playcanvas";
import { useCallback, useEffect, useRef, useState } from "react";

import { chooseShowcaseBackend } from "./backendSelection.js";
import { describeShowcaseError } from "./describeError.js";
import { loadExplainerAssets } from "./explainer/explainerAssets.js";
import { ExplainerController } from "./explainer/ExplainerController.js";
import { ExplainerDebugPanel } from "./explainer/ExplainerDebugPanel.js";
import { explainerSceneConfig } from "./explainer/explainerSceneConfig.js";
import { PauseIcon, PlayIcon, SoundIcon, VrIcon } from "./icons.js";
import { subscribeToPlayerUi } from "./playerUiUpdates.js";
import { collectShowcaseQualityOptions } from "./qualityOptions.js";
import { XrTransportPanel } from "./XrTransportPanel.js";

import type { GaussianStreamingPlayerSnapshot } from "@6g-path/gaussian-player";
import type {
  PlayCanvasGraphicsBackend,
  PlayCanvasGaussianRendererAdapter as PlayCanvasAdapter,
} from "@6g-path/gaussian-renderer-playcanvas";

interface PlayerPageProps {
  requestedManifestUrl?: string;
}

type LoadState = "empty" | "loading" | "ready" | "error";

const configuredManifestUrl = import.meta.env.VITE_DEFAULT_MANIFEST_URL?.trim();
const staticLodEnvironmentValue = import.meta.env.VITE_STATIC_GS_LOD_LEVEL?.trim();
const configuredStaticLodLevel = staticLodEnvironmentValue
  ? Number(staticLodEnvironmentValue)
  : undefined;

export function PlayerPage({ requestedManifestUrl }: PlayerPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<GaussianStreamingPlayer | undefined>(undefined);
  const adapterRef = useRef<PlayCanvasAdapter | undefined>(undefined);
  const panelRef = useRef<XrTransportPanel | undefined>(undefined);
  const explainerRef = useRef<ExplainerController | undefined>(undefined);
  const snapshotRef = useRef<GaussianStreamingPlayerSnapshot | undefined>(undefined);
  const initialUrl = requestedManifestUrl ?? configuredManifestUrl ?? "";
  const [manifestInput, setManifestInput] = useState(initialUrl);
  const [manifestUrl, setManifestUrl] = useState(initialUrl);
  const [loadState, setLoadState] = useState<LoadState>(
    initialUrl ? "loading" : "empty",
  );
  const [error, setError] = useState<string>();
  const [backend, setBackend] = useState<PlayCanvasGraphicsBackend>();
  const [snapshot, setSnapshot] = useState<GaussianStreamingPlayerSnapshot>();
  const [qualityOptions, setQualityOptions] = useState<
    ReturnType<typeof collectShowcaseQualityOptions>
  >([]);
  const [xrAvailable, setXrAvailable] = useState(false);
  const [xrActive, setXrActive] = useState(false);
  const [explainer, setExplainer] = useState<ExplainerController>();
  const [explainerError, setExplainerError] = useState<string>();
  const [debugContext, setDebugContext] = useState<{
    adapter: PlayCanvasAdapter;
    player: GaussianStreamingPlayer;
  }>();
  const explainerDebug = isExplainerDebugEnabled();

  useEffect(() => {
    snapshotRef.current = snapshot;
    panelRef.current?.update();
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || manifestUrl === "") {
      return;
    }
    const targetCanvas = canvas;
    const abortController = new AbortController();
    let active = true;
    let unsubscribe: (() => void) | undefined;

    async function initialise() {
      setLoadState("loading");
      setError(undefined);
      try {
        validateManifestUrl(manifestUrl);
        const preferredBackend = await selectBackend();
        const result = await createWithFallback(
          targetCanvas,
          manifestUrl,
          preferredBackend,
          abortController.signal,
        );
        if (!active) {
          result.player.dispose();
          return;
        }
        playerRef.current = result.player;
        adapterRef.current = result.adapter;
        setDebugContext({ adapter: result.adapter, player: result.player });
        if (import.meta.env.DEV) {
          // Development-only handle for scene inspection from the console or tests.
          Object.assign(window, {
            __showcase: { adapter: result.adapter, player: result.player },
          });
        }
        setQualityOptions(collectShowcaseQualityOptions(result.player.sequence));
        setBackend(result.backend);
        unsubscribe = subscribeToPlayerUi(result.player, (next) => {
          setSnapshot(next);
          if (next.error !== undefined) setError(describeShowcaseError(next.error));
        });
        const support = await result.adapter.getXrSupportInfo();
        if (!active) return;
        setXrAvailable(support.available);
        setLoadState("ready");
        if (isExplainerDisabled())
          setExplainerError("Explainer loading disabled for comparison.");
        else void startExplainer(result.adapter, result.player);
      } catch (caught) {
        if (!active || abortController.signal.aborted) return;
        setError(describeShowcaseError(caught));
        setLoadState("error");
      }
    }
    async function startExplainer(
      adapter: PlayCanvasAdapter,
      player: GaussianStreamingPlayer,
    ) {
      try {
        const assets = await loadExplainerAssets(
          explainerSceneConfig.assetsUrl,
          abortController.signal,
        );
        const controller = await ExplainerController.create(
          adapter,
          player,
          assets,
          explainerSceneConfig,
          abortController.signal,
          isExplainerDebugEnabled(),
        );
        if (!active) {
          controller.dispose();
          return;
        }
        explainerRef.current = controller;
        setExplainer(controller);
      } catch (caught) {
        if (!active || abortController.signal.aborted) return;
        // The explainer is an optional layer; the presenter keeps playing without it.
        console.warn("Explainer disabled:", caught);
        setExplainerError(describeShowcaseError(caught));
      }
    }

    void initialise();
    return () => {
      active = false;
      abortController.abort();
      unsubscribe?.();
      explainerRef.current?.dispose();
      explainerRef.current = undefined;
      setExplainer(undefined);
      setExplainerError(undefined);
      panelRef.current?.dispose();
      panelRef.current = undefined;
      playerRef.current?.dispose();
      playerRef.current = undefined;
      adapterRef.current = undefined;
      setDebugContext(undefined);
      setQualityOptions([]);
      setXrActive(false);
    };
  }, [manifestUrl]);

  const togglePlayback = useCallback(() => {
    const player = playerRef.current;
    if (player === undefined) return;
    if (player.snapshot.isPlaying) player.pause();
    else {
      setError(undefined);
      void player.play().catch((caught) => {
        if (playerRef.current === player) setError(describeShowcaseError(caught));
      });
    }
  }, []);

  const seek = useCallback((time: number) => {
    const player = playerRef.current;
    if (player === undefined) return;
    void player
      .seek(Math.min(Math.max(0, time), player.snapshot.durationSeconds))
      .then(() => {
        if (playerRef.current === player && player.snapshot.error === undefined)
          setError(undefined);
      })
      .catch((caught) => {
        if (playerRef.current === player) setError(describeShowcaseError(caught));
      });
  }, []);

  async function toggleXr() {
    const adapter = adapterRef.current;
    if (adapter === undefined) return;
    try {
      if (adapter.isXrActive()) {
        panelRef.current?.dispose();
        panelRef.current = undefined;
        await adapter.endXr();
        setXrActive(false);
      } else {
        await adapter.startXr({ optionalFeatures: ["hand-tracking", "local-floor"] });
        panelRef.current = new XrTransportPanel(adapter, {
          getSnapshot: () => snapshotRef.current,
          recenter: () => undefined,
          seek,
          setMuted: (muted) => playerRef.current?.setMuted(muted),
          togglePlayback,
        });
        setXrActive(true);
      }
    } catch (caught) {
      setError(describeShowcaseError(caught));
    }
  }

  function submitManifest(event: React.FormEvent) {
    event.preventDefault();
    const value = manifestInput.trim();
    if (value === "") return;
    try {
      validateManifestUrl(value);
      window.location.hash = `/demo?manifest=${encodeURIComponent(value)}`;
      setManifestUrl(value);
    } catch (caught) {
      setError(describeShowcaseError(caught));
      setLoadState("error");
    }
  }

  const currentTime = snapshot?.currentTimeSeconds ?? 0;
  const duration = snapshot?.durationSeconds ?? 0;
  const bufferedRanges = normalizeBufferedRanges(
    snapshot?.bufferedTimeRanges ?? [],
    duration,
  );
  const decodedRanges = normalizeBufferedRanges(
    snapshot?.decodedTimeRanges ?? [],
    duration,
  );
  const decodedFrameCount = Math.max(0, Math.floor(snapshot?.decodedFrameCount ?? 0));
  const playedRatio = duration > 0 ? clampRatio(currentTime / duration) : 0;
  const playerStatus =
    loadState === "ready" && snapshot !== undefined
      ? snapshot.lifecycle === "BUFFERING"
        ? "Buffering playback"
        : snapshot.isPlaying
          ? "Playing"
          : "Streaming ready"
      : loadState === "loading"
        ? "Preparing scene"
        : loadState === "error"
          ? "Needs attention"
          : loadState === "ready"
            ? "Streaming ready"
            : "Choose a dataset";
  const selectedQuality =
    snapshot?.qualityMode.mode === "manual"
      ? String(snapshot.qualityMode.detailLevel)
      : "automatic";
  const automaticQualityLabel = formatAutomaticQuality(snapshot, qualityOptions);
  const qualityTooltip = formatQualityTooltip(snapshot, configuredStaticLodLevel);
  return (
    <main className="player-page">
      <canvas
        ref={canvasRef}
        className="player-canvas"
        aria-label="4D Gaussian Splat scene"
      />
      <header className="player-header">
        <a className="brand player-brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            Volograms <b>4DGS</b>
          </span>
        </a>
        <div className="player-status">
          <span className={`status-dot ${loadState}`} />
          {playerStatus}
          {backend ? <b>{backend.toUpperCase()}</b> : null}
        </div>
      </header>

      {loadState === "empty" || loadState === "error" ? (
        <section className="manifest-dialog" aria-labelledby="manifest-title">
          <span className="eyebrow">
            <i /> External content
          </span>
          <h1 id="manifest-title">Open a 4DGS manifest</h1>
          <p>
            Enter a version 1.0 or 1.1 manifest URL. Hosted datasets require HTTPS and
            CORS; local development can use a path such as /manifest.json.
          </p>
          <form onSubmit={submitManifest}>
            <label htmlFor="manifest-url">Manifest URL</label>
            <div>
              <input
                id="manifest-url"
                type="text"
                inputMode="url"
                required
                autoFocus
                placeholder="/manifest.json or https://cdn.example.com/manifest.json"
                value={manifestInput}
                onChange={(event) => setManifestInput(event.target.value)}
              />
              <button className="button button-primary" type="submit">
                Load scene
              </button>
            </div>
          </form>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <a href="#/">← Back to project overview</a>
        </section>
      ) : null}

      {loadState === "loading" ? (
        <div className="player-loader" role="status">
          <span />
          <strong>Preparing spatial playback</strong>
          <small>Loading the manifest and minimum playable frames…</small>
        </div>
      ) : null}

      {loadState === "ready" && snapshot ? (
        <section className="transport" aria-label="Playback controls">
          <button
            type="button"
            className="icon-button"
            onClick={() => seek(currentTime - 5)}
            aria-label="Seek backward 5 seconds"
          >
            −5
          </button>
          <button
            type="button"
            className="play-button"
            onClick={togglePlayback}
            aria-label={snapshot.isPlaying ? "Pause" : "Play"}
          >
            {snapshot.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => seek(currentTime + 5)}
            aria-label="Seek forward 5 seconds"
          >
            +5
          </button>
          <time>{formatTime(currentTime)}</time>
          <div
            className="timeline-shell"
            title="Grey shows downloaded frames. Green shows decoded frames ready to present. Pink shows played time."
          >
            <div className="timeline-track" aria-hidden="true">
              {bufferedRanges.map((range, index) => (
                <span
                  className="timeline-buffer-range"
                  key={`${range.startSeconds}-${range.endSeconds}-${index}`}
                  style={{
                    left: `${(range.startSeconds / duration) * 100}%`,
                    width: `${((range.endSeconds - range.startSeconds) / duration) * 100}%`,
                  }}
                />
              ))}
              <span
                className="timeline-played"
                style={{ width: `${playedRatio * 100}%` }}
              />
            </div>
            <div className="timeline-decoded-track" aria-hidden="true">
              {decodedRanges.map((range, index) => (
                <span
                  className="timeline-decoded-range"
                  key={`${range.startSeconds}-${range.endSeconds}-${index}`}
                  style={{
                    left: `${(range.startSeconds / duration) * 100}%`,
                    width: `${((range.endSeconds - range.startSeconds) / duration) * 100}%`,
                  }}
                />
              ))}
            </div>
            <input
              className="timeline"
              aria-label="Playback position"
              aria-describedby="timeline-legend"
              type="range"
              min="0"
              max={Math.max(duration, 0.01)}
              step="0.01"
              value={Math.min(currentTime, duration)}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span
              className="timeline-ready-count"
              title={formatBufferSummary(snapshot)}
            >
              <span>Ready {decodedFrameCount} frames</span>
              {snapshot.bufferDiagnostics === undefined ? null : (
                <span className="timeline-ready-duration">
                  {" "}
                  · {snapshot.bufferDiagnostics.decodedAheadSeconds.toFixed(1)}s
                </span>
              )}
            </span>
            {snapshot.bufferDiagnostics === undefined ? null : (
              <span
                className="timeline-download-count"
                title={formatBufferSummary(snapshot)}
              >
                Downloaded{" "}
                {snapshot.bufferDiagnostics.downloadedAheadSeconds.toFixed(1)}s
              </span>
            )}
          </div>
          <span id="timeline-legend" className="sr-only">
            Timeline colors: grey shows downloaded frames, green shows decoded frames
            ready to present, and pink shows played time.
          </span>
          <time>{formatTime(duration)}</time>
          {snapshot.audio.configured ? (
            <>
              <button
                type="button"
                className={`icon-button ${snapshot.audio.muted ? "muted" : ""}`}
                onClick={() => playerRef.current?.setMuted(!snapshot.audio.muted)}
                aria-label={snapshot.audio.muted ? "Unmute" : "Mute"}
              >
                <SoundIcon />
              </button>
              <input
                className="volume"
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={snapshot.audio.volume}
                onChange={(event) =>
                  playerRef.current?.setVolume(Number(event.target.value))
                }
              />
            </>
          ) : null}
          {qualityOptions.length > 0 ? (
            <label className="quality-control" title={qualityTooltip}>
              <select
                aria-label="Streaming quality"
                value={selectedQuality}
                onChange={(event) => {
                  const value = event.target.value;
                  playerRef.current?.setQualityMode(
                    value === "automatic"
                      ? { mode: "automatic" }
                      : { detailLevel: Number(value), mode: "manual" },
                  );
                }}
              >
                <option value="automatic">Auto · {automaticQualityLabel}</option>
                {qualityOptions.map((option) => (
                  <option key={option.detailLevel} value={option.detailLevel}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="quality-pill" title={qualityTooltip}>
              AUTO · {automaticQualityLabel}
            </span>
          )}
          {xrAvailable ? (
            <button type="button" className="xr-enter" onClick={() => void toggleXr()}>
              <VrIcon /> {xrActive ? "Exit VR" : "Enter VR"}
            </button>
          ) : null}
        </section>
      ) : null}

      {loadState === "ready" && explainerDebug ? (
        <ExplainerDebugPanel
          adapter={debugContext?.adapter}
          controller={explainer}
          error={explainerError}
          snapshot={snapshot}
          seek={seek}
        />
      ) : null}

      {loadState === "ready" && error ? (
        <button type="button" className="toast" onClick={() => setError(undefined)}>
          {error}
          <span>Dismiss</span>
        </button>
      ) : null}
    </main>
  );
}

async function createWithFallback(
  canvas: HTMLCanvasElement,
  manifest: string,
  preferred: PlayCanvasGraphicsBackend,
  signal: AbortSignal,
) {
  try {
    return await createPlayer(canvas, manifest, preferred, signal);
  } catch (error) {
    if (preferred === "webgl2" || signal.aborted) throw error;
    return createPlayer(canvas, manifest, "webgl2", signal);
  }
}

async function createPlayer(
  canvas: HTMLCanvasElement,
  manifest: string,
  backend: PlayCanvasGraphicsBackend,
  signal: AbortSignal,
) {
  const buffer = readBufferOptions();
  const adapter = new PlayCanvasGaussianRendererAdapter({
    canvas,
    graphicsBackend: backend,
    sogPreparationWorkers: Number(
      import.meta.env.VITE_SOG_PREPARATION_WORKERS?.trim() || 1,
    ),
    gaussianSort: "auto",
    stochasticAlpha: readStrictBooleanEnvironmentValue(
      import.meta.env.VITE_PLAYCANVAS_GSPLAT_STOCHASTIC_ALPHA,
      "VITE_PLAYCANVAS_GSPLAT_STOCHASTIC_ALPHA",
      false,
    ),
    gpuTimingSampleIntervalMs: isExplainerDebugEnabled() ? 1_000 : 0,
    manageResize: true,
    ...(configuredStaticLodLevel === undefined
      ? {}
      : { staticLodLevel: configuredStaticLodLevel }),
  });
  const player = await GaussianStreamingPlayer.create({
    loop: true,
    manifest,
    renderer: adapter,
    signal,
    buffer,
  });
  return { adapter, backend, player };
}

function readStrictBooleanEnvironmentValue(
  value: string | undefined,
  settingName: string,
  fallback: boolean,
): boolean {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return fallback;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  throw new Error(settingName + " must be 'true' or 'false'.");
}

function readBufferOptions() {
  const compressedBufferMb = readPositiveFiniteEnvironmentValue(
    import.meta.env.VITE_COMPRESSED_BUFFER_MB,
    "VITE_COMPRESSED_BUFFER_MB",
  );
  const targetBufferSeconds = readPositiveFiniteEnvironmentValue(
    import.meta.env.VITE_TARGET_BUFFER_SECONDS,
    "VITE_TARGET_BUFFER_SECONDS",
  );
  const decodedBufferMb = readPositiveFiniteEnvironmentValue(
    import.meta.env.VITE_DECODED_BUFFER_MB,
    "VITE_DECODED_BUFFER_MB",
  );
  const preparationConcurrency = readPositiveFiniteEnvironmentValue(
    import.meta.env.VITE_PREPARATION_CONCURRENCY,
    "VITE_PREPARATION_CONCURRENCY",
    true,
  );
  const fetchConcurrency = readPositiveFiniteEnvironmentValue(
    import.meta.env.VITE_FETCH_CONCURRENCY,
    "VITE_FETCH_CONCURRENCY",
    true,
  );
  return {
    ...(decodedBufferMb === undefined
      ? {}
      : { decodedBufferMaximumBytes: decodedBufferMb * 1_000_000 }),
    ...(compressedBufferMb === undefined
      ? {}
      : { compressedBufferMaximumBytes: compressedBufferMb * 1_000_000 }),
    ...(targetBufferSeconds === undefined ? {} : { targetBufferSeconds }),
    ...(preparationConcurrency === undefined
      ? {}
      : { maximumBasePreparationConcurrency: preparationConcurrency }),
    ...(fetchConcurrency === undefined
      ? {}
      : { maximumCompressedFetchConcurrency: fetchConcurrency }),
  };
}

function readPositiveFiniteEnvironmentValue(
  value: string | undefined,
  settingName: string,
  requireInteger = false,
): number | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (requireInteger && !Number.isInteger(parsed))
  ) {
    throw new Error(
      `${settingName} must be a positive ${requireInteger ? "integer" : "finite number"}.`,
    );
  }
  return parsed;
}

async function selectBackend(): Promise<PlayCanvasGraphicsBackend> {
  const hasWebGpu = "gpu" in navigator;
  if (!hasWebGpu || import.meta.env.VITE_ENABLE_XR === "false") {
    return chooseShowcaseBackend(hasWebGpu, true);
  }
  const support = await queryPlayCanvasImmersiveVrSupport("webgpu");
  return chooseShowcaseBackend(hasWebGpu, false, support.reason);
}

function isExplainerDebugEnabled(): boolean {
  if (import.meta.env.VITE_EXPLAINER_DEBUG === "true") return true;
  if (typeof window === "undefined") return false;
  const query = window.location.hash.split("?", 2)[1] ?? "";
  return new URLSearchParams(query).has("debug");
}

function isExplainerDisabled(): boolean {
  const query = window.location.hash.split("?", 2)[1] ?? "";
  return new URLSearchParams(query).get("explainer") === "off";
}

function validateManifestUrl(value: string): void {
  const url = new URL(value, window.location.href);
  if (window.location.protocol === "https:" && url.protocol !== "https:") {
    throw new Error("The hosted player requires an HTTPS manifest URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Manifest URL must use HTTP or HTTPS.");
  }
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function normalizeBufferedRanges(
  ranges: readonly { startSeconds: number; endSeconds: number }[],
  duration: number,
): readonly { startSeconds: number; endSeconds: number }[] {
  if (!(duration > 0)) return [];
  return ranges.flatMap((range) => {
    const startSeconds = Math.min(duration, Math.max(0, range.startSeconds));
    const endSeconds = Math.min(duration, Math.max(0, range.endSeconds));
    return Number.isFinite(startSeconds) &&
      Number.isFinite(endSeconds) &&
      endSeconds > startSeconds
      ? [{ startSeconds, endSeconds }]
      : [];
  });
}

function formatQuality(snapshot: GaussianStreamingPlayerSnapshot): string {
  const rendered = snapshot.renderer.renderedSplatCount;
  return rendered === undefined ? "adaptive" : `${Math.round(rendered / 1000)}k splats`;
}

function formatAutomaticQuality(
  snapshot: GaussianStreamingPlayerSnapshot | undefined,
  options: readonly { detailLevel: number; label: string }[],
): string {
  if (snapshot === undefined) return "adaptive";
  const detailLevel = snapshot.qualityDiagnostics?.dynamicFrameDetailLevel;
  if (typeof detailLevel === "number" && Number.isFinite(detailLevel)) {
    const matchingOption = options.find((option) => {
      const tolerance = Math.max(0.005, Math.abs(option.detailLevel) * 0.02);
      return Math.abs(option.detailLevel - detailLevel) <= tolerance;
    });
    if (matchingOption !== undefined) return matchingOption.label;
  }
  return formatQuality(snapshot);
}

function formatQualityTooltip(
  snapshot: GaussianStreamingPlayerSnapshot | undefined,
  staticLodLevel?: number,
): string {
  const base =
    staticLodLevel === undefined
      ? "Dynamic transfer quality. Static Streamed SOG remains camera-adaptive."
      : `Dynamic transfer quality. Static Streamed SOG is pinned to LOD ${staticLodLevel}.`;
  if (snapshot === undefined) return base;
  const diagnostics = snapshot.qualityDiagnostics;
  if (diagnostics === undefined) return `${base} ${formatBufferSummary(snapshot)}`;
  const throughput =
    Number.isFinite(diagnostics.estimatedThroughputBps) &&
    diagnostics.estimatedThroughputBps > 0 &&
    Number.isFinite(diagnostics.networkConfidence) &&
    diagnostics.networkConfidence > 0
      ? `Measured ${(diagnostics.estimatedThroughputBps / 1_000_000).toFixed(1)} Mbps`
      : "No fresh throughput evidence";
  const timing = snapshot.presentationTiming;
  const timingText =
    timing === undefined
      ? ""
      : ` Pipeline ${timing.pipelineDurationMs.toFixed(1)} ms (max ${timing.maximumPipelineDurationMs.toFixed(1)}); callback late ${timing.callbackLatenessMs.toFixed(1)} ms (wall ${timing.callbackWallLatenessMs.toFixed(1)}, max ${timing.maximumCallbackLatenessMs.toFixed(1)}); listeners ${timing.notificationDurationMs.toFixed(1)} ms.`;
  return `${base} Downloaded ${formatDiagnosticSeconds(diagnostics.compressedBufferAheadSeconds ?? aheadSecondsAtTime(snapshot.bufferedTimeRanges, snapshot.currentTimeSeconds))} ahead; decoded ${formatDiagnosticSeconds(diagnostics.bufferAheadSeconds)} ahead; source ${formatDiagnosticValue(diagnostics.targetFramesPerSecond, " FPS")}; render ${formatDiagnosticValue(snapshot.renderer.renderFramesPerSecond, " FPS")}; handoff ${formatDiagnosticValue(snapshot.renderer.frameCommitTimeMs, " ms")}; lifecycle ${formatDiagnosticText(snapshot.lifecycle)}; dropped frames ${formatDiagnosticInteger(snapshot.droppedFrameCount)}; ${throughput}.${timingText}`;
}

function formatDiagnosticSeconds(value: number): string {
  return Number.isFinite(value) ? `${Math.max(0, value).toFixed(2)}s` : "n/a";
}

function formatBufferSummary(snapshot: GaussianStreamingPlayerSnapshot): string {
  const buffer = snapshot.bufferDiagnostics;
  if (buffer === undefined) return "Decoded frames are ready to present.";
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  return `Downloaded ${buffer.downloadedAheadSeconds.toFixed(2)}s ahead (${mb(buffer.compressedResidentBytes)} / ${mb(buffer.compressedCapacityBytes)} MB). Decoded ${buffer.decodedAheadSeconds.toFixed(2)}s ahead (${mb(buffer.decodedResidentBytes)} / ${mb(buffer.decodedCapacityBytes)} MB estimated CPU/GPU memory; target ${buffer.decodedTargetFrames} frames).`;
}

function formatDiagnosticValue(value: number | undefined, suffix: string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)}${suffix}`
    : `n/a${suffix}`;
}

function formatDiagnosticText(value: string | undefined): string {
  return value === undefined || value === "" ? "unknown" : value;
}

function formatDiagnosticInteger(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.max(0, Math.floor(value)))
    : "n/a";
}

function aheadSecondsAtTime(
  ranges: readonly { startSeconds: number; endSeconds: number }[],
  currentTime: number,
): number {
  if (!Number.isFinite(currentTime)) return 0;
  const range = ranges.find(
    ({ startSeconds, endSeconds }) =>
      Number.isFinite(startSeconds) &&
      Number.isFinite(endSeconds) &&
      startSeconds <= currentTime &&
      currentTime < endSeconds,
  );
  return range === undefined ? 0 : Math.max(0, range.endSeconds - currentTime);
}
