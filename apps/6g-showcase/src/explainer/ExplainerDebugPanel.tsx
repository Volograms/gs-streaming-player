import { useEffect, useState } from "react";

import type { ExplainerController, ExplainerDebugInfo } from "./ExplainerController.js";
import type { ExplainerDiagnosticMode } from "./explainerPerformance.js";
import type { ExplainerVisualToggles } from "./ExplainerScene.js";
import type {
  GaussianStreamingPlayer,
  GaussianStreamingPlayerSnapshot,
} from "@6g-path/gaussian-player";
import type {
  PlayCanvasGaussianRendererAdapter,
  PlayCanvasRendererMetrics,
} from "@6g-path/gaussian-renderer-playcanvas";

interface ExplainerDebugPanelProps {
  adapter: PlayCanvasGaussianRendererAdapter | undefined;
  controller: ExplainerController | undefined;
  error: string | undefined;
  player: GaussianStreamingPlayer | undefined;
  seek(timeSeconds: number): void;
}

const TOGGLE_LABELS: Record<keyof ExplainerVisualToggles, string> = {
  cameras: "Cameras",
  cloud: "Point cloud",
  comparison: "Photo / render / error",
  counters: "Counters",
  demo: "Demo object",
  densify: "Split / prune",
  ellipsoids: "Ellipsoids",
  hero: "Hero gaussian",
  projection: "Projection",
};

/** Development overlay: explainer time, active cues, beat jumps and visual toggles. */
export function ExplainerDebugPanel({
  adapter,
  controller,
  error,
  player,
  seek,
}: ExplainerDebugPanelProps) {
  const [info, setInfo] = useState<ExplainerDebugInfo>();
  const [snapshot, setSnapshot] = useState<GaussianStreamingPlayerSnapshot>();
  const [, setToggleRevision] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (controller !== undefined) setInfo({ ...controller.debugInfo });
      if (player !== undefined) setSnapshot(player.snapshot);
    }, 250);
    return () => window.clearInterval(timer);
  }, [controller, player]);

  const metrics = snapshot?.renderer as PlayCanvasRendererMetrics | undefined;
  const cpu = controller?.performance.snapshot;
  const ms = (value: number | undefined) =>
    value === undefined ? "n/a" : `${value.toFixed(2)} ms`;
  const performanceReadout = (
    <div aria-label="Playback performance">
      <p>
        Page {document.visibilityState} ·{" "}
        {document.hasFocus() ? "focused" : "unfocused"}
      </p>
      <p>
        Render {metrics?.renderFramesPerSecond?.toFixed(1) ?? "n/a"} FPS · frame{" "}
        {ms(metrics?.frameTimeMs)}
      </p>
      <p>
        Render CPU {ms(metrics?.renderCallTimeMs)} · update{" "}
        {ms(adapter?.application.stats.frame.updateTime)}
      </p>
      <p>
        GPU{" "}
        {metrics?.gpuTimings.frameTime === undefined
          ? (metrics?.gpuTimings.status ?? "n/a")
          : ms(metrics.gpuTimings.frameTime.latestMs)}{" "}
        · sort {ms(metrics?.sortTimeMs)}
      </p>
      <p>
        Pipeline {ms(snapshot?.presentationTiming?.pipelineDurationMs)} · handoff{" "}
        {ms(metrics?.frameCommitTimeMs)} · dropped {snapshot?.droppedFrameCount ?? 0}
      </p>
      <p>
        Decoded {snapshot?.decodedFrameCount ?? 0} frames ·{" "}
        {snapshot?.bufferDiagnostics?.decodedAheadSeconds.toFixed(2) ?? "0"} s ahead
      </p>
      {snapshot?.qualityMode.mode !== "automatic" ||
      snapshot.qualityDiagnostics?.presentedDynamicDetailLevel === undefined ? null : (
        <p>
          Transfer target{" "}
          {(snapshot.qualityDiagnostics.dynamicFrameDetailLevel * 100).toFixed(0)}%
          {" · "}on screen{" "}
          {(snapshot.qualityDiagnostics.presentedDynamicDetailLevel * 100).toFixed(0)}%
        </p>
      )}
      <p>
        Explainer CPU p95 {ms(cpu?.totalMs)} ({cpu?.sampleCount ?? 0} updates)
      </p>
      {cpu === undefined ? null : (
        <p>
          Snapshot {ms(cpu.snapshotMs)} · cues {ms(cpu.evaluateMs)} · scene{" "}
          {ms(cpu.applyMs)}
        </p>
      )}
    </div>
  );

  if (controller === undefined) {
    return (
      <aside className="explainer-debug" aria-label="Explainer debug">
        <strong>Explainer</strong>
        <p>{error ?? "Loading explainer assets…"}</p>
        {performanceReadout}
      </aside>
    );
  }

  const time = info?.timeSeconds ?? 0;
  return (
    <aside className="explainer-debug" aria-label="Explainer debug">
      <strong>Explainer</strong>
      <p className="explainer-debug-time">
        {time.toFixed(2)} s · frame {info?.frameIndex ?? 0}
      </p>
      <label>
        Explainer comparison{" "}
        <select
          aria-label="Explainer comparison"
          value={controller.diagnosticMode}
          onChange={(event) => {
            controller.setDiagnosticMode(event.target.value as ExplainerDiagnosticMode);
            setToggleRevision((revision) => revision + 1);
          }}
        >
          <option value="live">Live animation</option>
          <option value="frozen">Frozen visuals (no updates)</option>
          <option value="hidden">Hidden (no updates or draws)</option>
        </select>
      </label>
      {performanceReadout}
      <div className="explainer-debug-row">
        <button type="button" onClick={() => seek(time - 1)}>
          −1 s
        </button>
        <button type="button" onClick={() => seek(time + 1)}>
          +1 s
        </button>
        <select
          aria-label="Jump to cue"
          value=""
          onChange={(event) => seek(Number(event.target.value))}
        >
          <option value="">Jump to cue…</option>
          {controller.timeline.cues.map((cue) => (
            <option key={cue.id} value={cue.startSeconds}>
              {cue.startSeconds.toFixed(1)} s · {cue.id}
            </option>
          ))}
        </select>
      </div>
      <div className="explainer-debug-row">
        {(Object.keys(TOGGLE_LABELS) as (keyof ExplainerVisualToggles)[]).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={controller.toggles[key]}
              onChange={(event) => {
                controller.toggles[key] = event.target.checked;
                controller.refresh();
                setToggleRevision((revision) => revision + 1);
              }}
            />
            {TOGGLE_LABELS[key]}
          </label>
        ))}
      </div>
      <ul>
        {(info?.activeCueIds ?? []).map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
    </aside>
  );
}
