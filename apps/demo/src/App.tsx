import { CONTENT_TOOL_COMMANDS } from "@6g-path/gaussian-content-tools";
import { createInitialPlaybackState } from "@6g-path/gaussian-player";
import { sparkRendererCapabilities } from "@6g-path/gaussian-renderer-spark";
import { SIX_G_TELEMETRY_PACKAGE_ID } from "@6g-path/gaussian-telemetry-6g";
import { createIdentityTransform } from "@6g-path/shared";

import { getFoundationStatus } from "./foundationStatus.js";
import { PlaybackPerformancePanel } from "./PlaybackPerformancePanel.js";
import { PlaybackTracePanel } from "./PlaybackTracePanel.js";
import { SparkViewport } from "./SparkViewport.js";
import { usePlaybackDiagnostics } from "./usePlaybackDiagnostics.js";

const origin = createIdentityTransform();

export function App() {
  const {
    clearTrace,
    onPlaybackSnapshot,
    onTrace,
    performanceEvents,
    playbackSnapshot,
    visibleEvents,
  } = usePlaybackDiagnostics();
  const playbackLifecycle =
    playbackSnapshot?.lifecycle ?? createInitialPlaybackState().lifecycle;
  const statusItems = getFoundationStatus();

  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">6G-PATH · Player foundation</p>
        <h1 id="page-title">Adaptive Gaussian Splat Streaming</h1>
        <p className="lede">
          A reusable player for composited static scenes, dynamic Gaussian sequences,
          and conventional Three.js meshes.
        </p>
      </section>

      <section className="viewer-shell" aria-label="Player preview">
        <SparkViewport
          onBufferTrace={onTrace}
          onPlaybackSnapshot={onPlaybackSnapshot}
        />
        <aside className="status-panel">
          <h2>Foundation status</h2>
          <ul>
            {statusItems.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong data-status={item.status}>{item.status}</strong>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="details" aria-label="Workspace diagnostics">
        <article>
          <span>Player lifecycle</span>
          <strong data-player-lifecycle={playbackLifecycle}>{playbackLifecycle}</strong>
        </article>
        <article>
          <span>RAD paging</span>
          <strong>
            {sparkRendererCapabilities.pagedRadStreaming ? "supported" : "unavailable"}
          </strong>
        </article>
        <article>
          <span>Content commands</span>
          <strong>{CONTENT_TOOL_COMMANDS.length} planned</strong>
        </article>
        <article>
          <span>Scene origin</span>
          <strong>
            {origin.position.x}, {origin.position.y}, {origin.position.z}
          </strong>
        </article>
      </section>

      <PlaybackPerformancePanel
        events={performanceEvents}
        {...(playbackSnapshot === undefined ? {} : { playback: playbackSnapshot })}
      />
      <PlaybackTracePanel events={visibleEvents} onClear={clearTrace} />

      <footer>{SIX_G_TELEMETRY_PACKAGE_ID}</footer>
    </main>
  );
}
