import { GaussianStreamingPlayer } from "@6g-path/gaussian-player";
import {
  PlayCanvasGaussianRendererAdapter,
  queryPlayCanvasImmersiveVrSupport,
} from "@6g-path/gaussian-renderer-playcanvas";
import { useCallback, useEffect, useRef, useState } from "react";

import { chooseShowcaseBackend } from "./backendSelection.js";
import { describeShowcaseError } from "./describeError.js";
import { PauseIcon, PlayIcon, SoundIcon, VrIcon } from "./icons.js";
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

export function PlayerPage({ requestedManifestUrl }: PlayerPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<GaussianStreamingPlayer | undefined>(undefined);
  const adapterRef = useRef<PlayCanvasAdapter | undefined>(undefined);
  const panelRef = useRef<XrTransportPanel | undefined>(undefined);
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
        setQualityOptions(collectShowcaseQualityOptions(result.player.sequence));
        setBackend(result.backend);
        unsubscribe = result.player.subscribe((next) => {
          setSnapshot({ ...next });
          if (next.error !== undefined) setError(describeShowcaseError(next.error));
        });
        const support = await result.adapter.getXrSupportInfo();
        if (!active) return;
        setXrAvailable(support.available);
        setLoadState("ready");
      } catch (caught) {
        if (!active || abortController.signal.aborted) return;
        setError(describeShowcaseError(caught));
        setLoadState("error");
      }
    }
    void initialise();
    return () => {
      active = false;
      abortController.abort();
      unsubscribe?.();
      panelRef.current?.dispose();
      panelRef.current = undefined;
      playerRef.current?.dispose();
      playerRef.current = undefined;
      adapterRef.current = undefined;
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
  const selectedQuality =
    snapshot?.qualityMode.mode === "manual"
      ? String(snapshot.qualityMode.detailLevel)
      : "automatic";
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
          {loadState === "ready"
            ? "Streaming ready"
            : loadState === "loading"
              ? "Preparing scene"
              : loadState === "error"
                ? "Needs attention"
                : "Choose a dataset"}
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
          <input
            className="timeline"
            aria-label="Playback position"
            type="range"
            min="0"
            max={Math.max(duration, 0.01)}
            step="0.01"
            value={Math.min(currentTime, duration)}
            onChange={(event) => seek(Number(event.target.value))}
          />
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
            <label
              className="quality-control"
              title="Dynamic transfer quality. Static Streamed SOG remains camera-adaptive."
            >
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
                <option value="automatic">Auto · {formatQuality(snapshot)}</option>
                {qualityOptions.map((option) => (
                  <option key={option.detailLevel} value={option.detailLevel}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="quality-pill">AUTO · {formatQuality(snapshot)}</span>
          )}
          {xrAvailable ? (
            <button type="button" className="xr-enter" onClick={() => void toggleXr()}>
              <VrIcon /> {xrActive ? "Exit VR" : "Enter VR"}
            </button>
          ) : null}
        </section>
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
  const adapter = new PlayCanvasGaussianRendererAdapter({
    canvas,
    graphicsBackend: backend,
    gaussianSort: "auto",
    manageResize: true,
  });
  const player = await GaussianStreamingPlayer.create({
    loop: true,
    manifest,
    renderer: adapter,
    signal,
  });
  return { adapter, backend, player };
}

async function selectBackend(): Promise<PlayCanvasGraphicsBackend> {
  const hasWebGpu = "gpu" in navigator;
  if (!hasWebGpu || import.meta.env.VITE_ENABLE_XR === "false") {
    return chooseShowcaseBackend(hasWebGpu, true);
  }
  const support = await queryPlayCanvasImmersiveVrSupport("webgpu");
  return chooseShowcaseBackend(hasWebGpu, false, support.reason);
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

function formatQuality(snapshot: GaussianStreamingPlayerSnapshot): string {
  const rendered = snapshot.renderer.renderedSplatCount;
  return rendered === undefined ? "adaptive" : `${Math.round(rendered / 1000)}k splats`;
}
