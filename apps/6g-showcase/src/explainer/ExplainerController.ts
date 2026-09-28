import { evaluateTimeline, parseCueTimeline } from "@6g-path/cue-timeline";

import cueDocument from "../../explainer/cues.json";

import { loadSparsePoints } from "./explainerAssets.js";
import { explainerTimeSeconds } from "./explainerClock.js";
import { ExplainerScene } from "./ExplainerScene.js";
import { computeExplainerState } from "./explainerState.js";

import type { ExplainerAssets } from "./explainerAssets.js";
import type { ExplainerVisualToggles } from "./ExplainerScene.js";
import type { ExplainerSceneConfig } from "./explainerSceneConfig.js";
import type { CueTimeline } from "@6g-path/cue-timeline";
import type { GaussianStreamingPlayer } from "@6g-path/gaussian-player";
import type { PlayCanvasGaussianRendererAdapter } from "@6g-path/gaussian-renderer-playcanvas";

export interface ExplainerDebugInfo {
  activeCueIds: readonly string[];
  frameIndex: number;
  timeSeconds: number;
}

/**
 * Drives the explainer scene from the presenter frame on screen. Each render update
 * evaluates the cue timeline at that frame's time, so the layer has no state of its own
 * to drift, and seeking or stalling the player moves it too.
 */
export class ExplainerController {
  readonly timeline: CueTimeline;
  readonly toggles: ExplainerVisualToggles = {
    cameras: true,
    cloud: true,
    counters: true,
    demo: true,
    densify: true,
    hero: true,
    stage: true,
  };
  private readonly adapter: PlayCanvasGaussianRendererAdapter;
  private readonly assets: ExplainerAssets;
  private debug: ExplainerDebugInfo = {
    activeCueIds: [],
    frameIndex: 0,
    timeSeconds: 0,
  };
  private disposed = false;
  private readonly frameTimestamps: readonly number[];
  private readonly player: GaussianStreamingPlayer;
  private readonly scene: ExplainerScene;
  private readonly updateListener = () => this.update();

  static async create(
    adapter: PlayCanvasGaussianRendererAdapter,
    player: GaussianStreamingPlayer,
    assets: ExplainerAssets,
    config: ExplainerSceneConfig,
    signal?: AbortSignal,
  ): Promise<ExplainerController> {
    const timeline = parseCueTimeline(cueDocument);
    validateAcrossTimeline(timeline, assets);
    const sparsePoints = await loadSparsePoints(assets.sparsePoints, signal);
    const scene = await ExplainerScene.create(
      adapter,
      assets,
      sparsePoints,
      config,
      signal,
    );
    return new ExplainerController(adapter, player, assets, timeline, scene);
  }

  private constructor(
    adapter: PlayCanvasGaussianRendererAdapter,
    player: GaussianStreamingPlayer,
    assets: ExplainerAssets,
    timeline: CueTimeline,
    scene: ExplainerScene,
  ) {
    this.adapter = adapter;
    this.player = player;
    this.assets = assets;
    this.timeline = timeline;
    this.scene = scene;
    const { frameRate, frames } = player.sequence;
    this.frameTimestamps = frames.map(
      (frame, index) => frame.timestampSeconds ?? index / frameRate,
    );
    adapter.application.on("update", this.updateListener);
    this.update();
  }

  get debugInfo(): Readonly<ExplainerDebugInfo> {
    return this.debug;
  }

  /** Re-applies the current state, e.g. after a debug toggle while paused. */
  refresh(): void {
    this.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.adapter.application.off("update", this.updateListener);
    this.scene.dispose();
  }

  private update(): void {
    if (this.disposed) return;
    const snapshot = this.player.snapshot;
    const frameIndex = snapshot.renderer.activeFrameIndex ?? snapshot.currentFrameIndex;
    const timeSeconds = explainerTimeSeconds({
      clockSeconds: snapshot.currentTimeSeconds,
      durationSeconds: snapshot.durationSeconds,
      frameIndex,
      frameTimestamps: this.frameTimestamps,
    });
    const state = evaluateTimeline(this.timeline, timeSeconds);
    this.scene.apply(
      computeExplainerState(this.timeline, state, this.assets),
      this.toggles,
    );
    this.debug = {
      activeCueIds: state.cues
        .filter(({ phase }) => phase === "active")
        .map(({ cue }) => cue.id),
      frameIndex,
      timeSeconds,
    };
  }
}

/** Fails at load, not mid-talk, if a cue's params do not fit the shipped assets. */
function validateAcrossTimeline(timeline: CueTimeline, assets: ExplainerAssets): void {
  const times = timeline.cues.flatMap(({ endSeconds, startSeconds }) => [
    startSeconds,
    (startSeconds + endSeconds) / 2,
    endSeconds,
  ]);
  for (const time of times) {
    computeExplainerState(timeline, evaluateTimeline(timeline, time), assets);
  }
}
