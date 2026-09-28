import { useEffect, useState } from "react";

import type { ExplainerController, ExplainerDebugInfo } from "./ExplainerController.js";
import type { ExplainerVisualToggles } from "./ExplainerScene.js";

interface ExplainerDebugPanelProps {
  controller: ExplainerController | undefined;
  error: string | undefined;
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
  controller,
  error,
  seek,
}: ExplainerDebugPanelProps) {
  const [info, setInfo] = useState<ExplainerDebugInfo>();
  const [, setToggleRevision] = useState(0);

  useEffect(() => {
    if (controller === undefined) return;
    const timer = window.setInterval(() => setInfo({ ...controller.debugInfo }), 100);
    return () => window.clearInterval(timer);
  }, [controller]);

  if (controller === undefined) {
    return (
      <aside className="explainer-debug" aria-label="Explainer debug">
        <strong>Explainer</strong>
        <p>{error ?? "Loading explainer assets…"}</p>
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
