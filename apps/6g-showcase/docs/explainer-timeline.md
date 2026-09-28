# Explainer cue timeline

The explainer's visuals follow `apps/6g-showcase/explainer/cues.json`, evaluated with
`@6g-path/cue-timeline` (`packages/cue-timeline`). Retiming a beat means editing that
file only.

## Time source

Every render evaluates the whole timeline at one time:

```ts
const time = presentationTimeSeconds({
  clockSeconds, // player playback clock (audio-driven)
  frameStartSeconds, // timestamp of the presenter frame on screen
  frameEndSeconds, // next frame's timestamp, or the sequence end
});
const state = evaluateTimeline(timeline, time);
```

That time is the audio clock held inside the presenter frame actually on screen. It
moves smoothly between frames, freezes with the presenter during a buffering stall, and
jumps with her on seek. Cue state depends only on that time and never on the order of
events, so seeking, pausing, looping and restarting always give the same state as
playing up to that time.

## `cues.json` (version 1)

| Field                              | Meaning                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `durationSeconds`                  | Presenter timeline length; no cue may end after it.                                                       |
| `strings`                          | Display text by key (Spanish today). Params named `label` or ending in `Label` must reference a key here. |
| `cues[].id`                        | Unique name, used by views and the debug panel.                                                           |
| `cues[].type`                      | What the cue drives, e.g. `demo-object.reveal`. The app defines the vocabulary.                           |
| `cues[].start`                     | Seconds on the presenter timeline.                                                                        |
| `cues[].end` or `cues[].duration`  | One of the two, never both.                                                                               |
| `cues[].fadeIn` / `cues[].fadeOut` | Optional ramps at the start and end of the cue's `envelope` (default 0).                                  |
| `cues[].params`                    | Type-specific values, validated by the view that consumes them.                                           |

Each evaluated cue reports:

- `phase`: `pending`, `active` or `done`;
- `progress`: linear 0 to 1 within the cue, clamped;
- `envelope`: 0 to 1 including the smoothed fades, and 0 outside the cue.

`sampleKeyframes` maps values such as the training-count curve from
`explainer-assets.json` onto cue progress.

The current timings are approximate, taken from the transcript segments in the spec. The
next refinement is word-level alignment (for example Whisper word timestamps) on the
presenter audio.

## In the showcase

Cue types the showcase draws today:

| Type                                                                                      | Visual                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo-object.reveal` (`iteration`)                                                        | The checkpoint grows in, standing on the floor beside the presenter.                                                                                                                                                                                                                                                                                           |
| `demo-object.turntable` (`turns`)                                                         | Rotates the object.                                                                                                                                                                                                                                                                                                                                            |
| `demo-object.show` (`iteration`)                                                          | Shows that checkpoint at full size with no growth, holding until the next object cue; used under the fading sparse cloud so the hand-over to training is seamless.                                                                                                                                                                                             |
| `demo-object.dissolve`                                                                    | The model falls back to its iteration-0 fog, then hides (the sparse cloud takes over).                                                                                                                                                                                                                                                                         |
| `training.progress` (`fromIteration`, `toIteration`)                                      | Steps through the shipped checkpoints, each shown for an equal share of the cue.                                                                                                                                                                                                                                                                               |
| `sparse-cloud.show` / `sparse-cloud.swell` / `sparse-cloud.dim`                           | SfM points as camera-facing dots; swell morphs them into soft blobs at their initial gaussian size; dim fades them.                                                                                                                                                                                                                                            |
| `camera-ring.show` / `camera-ring.highlight` (`camera`, must match the comparison camera) | Wireframe frusta at the capture poses; one emphasised camera.                                                                                                                                                                                                                                                                                                  |
| `hero-gaussian.show`                                                                      | One enlarged gaussian comes out of the cloud to its presentation pose (drawn as a true 3D gaussian: peak density along each view ray).                                                                                                                                                                                                                         |
| `hero-gaussian.parameter` (`parameter`: `position`/`scale`/`opacity`/`color`, `label`)    | A full cycle of that parameter (loop with axes gizmo, stretch, fade, hue turn) that ends at the rest pose, with its label.                                                                                                                                                                                                                                     |
| `comparison-panels.show` (`realLabel`, `renderLabel`, `errorLabel`)                       | Three panels for one training camera: the real photo, the checkpoint on screen rendered from that camera, and an error heatmap (colour difference, near black = matches, red then yellow = wrong, limited to the object's footprint) that cools as training progresses.                                                                                        |
| `densify.show`                                                                            | Shows one patch of about 50 gaussians in the object's colours, above the empty pedestal during the close-up. It spans both steps below, so the viewer sees the same set change.                                                                                                                                                                                |
| `hero-gaussian.split` (`label`) / `hero-gaussian.prune` (`label`)                         | Densification: six large gaussians light up (the worst fit), then each splits into two children with sigma / 1.6 (the 3DGS factor) that start with the glow and cool down. Pruning: about ten faint gaussians are marked red, then shrink and vanish one after another. Both results hold after their cue.                                                     |
| `demo-object.ellipsoid-view` (`label`)                                                    | The final model's own gaussians (from `ellipsoids.bin`) grow in as solid, shaded ellipsoids at their real position, orientation and shape; once they cover the object its splat model is hidden, then they shrink away and it returns. Drawn opaque in the World layer, so splats depth-sort around them.                                                      |
| `projection.show` (`label`)                                                               | A screen appears beside the presenter, opposite the object. About 12,000 gaussians sampled from the object peel off it and fly to where their part of the object is in the image (the same pinhole camera as the offline render), flattening into 2D splats blended far to near. The full render of every gaussian (`projection.png`) then resolves over them. |
| `projection.present`                                                                      | Brings the finished image forward, larger, in front of the presenter (below her face); it holds to the end of the talk.                                                                                                                                                                                                                                        |
| `counter.iteration` / `counter.gaussians` (`label`)                                       | World-space counters with real training counts.                                                                                                                                                                                                                                                                                                                |

The cloud, cameras, hero gaussian and ellipsoids share an anchor that follows the
object's pose. The object stands on the floor to the presenter's left at one fixed,
large size (no pedestal); the counters, densification patch, comparison panels and
projection screen are placed in world space on her right. Their shaders
(`src/explainer/visuals/`) ship GLSL and WGSL; custom vertex streams use
texture-coordinate semantics, because PlayCanvas's generic `ATTRn` semantics share
locations with the standard ones.

`src/explainer/` connects the timeline to the scene:

- `ExplainerController` evaluates the cues on every PlayCanvas `update`. Its time source
  is the renderer's active frame and the player clock.
- `explainerState.ts` turns the cue states into what should be drawn: the checkpoint on
  the floor with its reveal/dissolve scale and turntable yaw, and the two counters. It
  is pure and tested against the real `cues.json`.
- `ExplainerScene` applies that state. It preloads every checkpoint at start-up as a
  hidden static splat through the renderer adapter, switches between them, and draws a
  billboarded counter panel.

The explainer loads after the player is ready. If its assets are missing, it logs a
warning and the presenter keeps playing without it.

Placement lives in `apps/6g-showcase/explainer/scene.json`:

| Field                                                                 | Meaning                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetsUrl`                                                           | `explainer-assets.json` from `gs-content build-explainer`, relative to the page.                                                                                                                              |
| `stage.position`                                                      | Where the object stands: its ground contact centre on the floor beside the presenter, in world metres.                                                                                                        |
| `stage.yawDegrees`                                                    | Object rotation about world +Y (−100 shows the truck side-on to the viewer).                                                                                                                                  |
| `stage.objectScale`                                                   | Stage metres (the reconstruction) to world metres; 0.45 makes the truck about 2.5 m long.                                                                                                                     |
| `counters.offset` / `counters.width`                                  | Counter panel position relative to the object base, and its width (world metres).                                                                                                                             |
| `hero` / `densify` / `ellipsoids` / `projection` `.labelWidth`        | Width of each label in world metres; labels further from the viewer need to be wider to read at the same size.                                                                                                |
| `hero.position` / `hero.sigma` / `hero.tiltDegrees`                   | Hero gaussian presentation pose in stage metres, its sigma (the drawn ellipsoid is 3 sigma) and a fixed tilt so stretching reads as orientation. It starts from the most saturated sparse point near the cab. |
| `hero.labelOffset`                                                    | Parameter label position above the hero, in world metres.                                                                                                                                                     |
| `densify.position` / `densify.scale` / `densify.labelOffset`          | Patch centre in world metres (it turns to face the viewer), world metres per patch unit, and the label position (world metres).                                                                               |
| `comparison.position` / `stack` / `width` / `gap` / `gain`            | Panel group centre (world metres, it turns to face the viewer), `column` or `row`, one panel's width, the spacing, and the heatmap error gain.                                                                |
| `ellipsoids.sigmas` / `ellipsoids.labelOffset`                        | Drawn ellipsoid radius in sigmas, and the label position from the object base (world metres).                                                                                                                 |
| `projection.position` / `projection.width` / `projection.labelOffset` | Projection screen centre (world metres, it turns to face the viewer), its width (the height follows the image), and the label position.                                                                       |
| `projection.presentPosition` / `projection.presentScale`              | Where the finished image is brought (world metres, below the eye line to her face) and its size there.                                                                                                        |

Environment overrides:

- `VITE_EXPLAINER_ASSETS_URL` replaces `assetsUrl`. When `SHOWCASE_LOCAL_DATASET_DIR`
  replaces Vite's public directory, either build the explainer assets into that
  directory or point this variable at them.
- `VITE_EXPLAINER_DEBUG=true`, or `#/demo?debug=1`, shows the debug panel: explainer
  time and frame, active cues, ±1 s, jump to any cue start, and toggles for each visual.
  The panel is DOM-only, so it is not visible inside a headset.

Transparent explainer meshes are drawn in PlayCanvas's `UI` layer. Splats do not write
depth, so a transparent mesh in the world layer can be painted over by the environment.
Development builds expose `window.__showcase = { adapter, player }` for inspection.
