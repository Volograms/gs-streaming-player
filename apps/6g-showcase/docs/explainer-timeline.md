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

`src/explainer/` connects the timeline to the scene:

- `ExplainerController` evaluates the cues on every PlayCanvas `update`. Its time source
  is the renderer's active frame and the player clock.
- `explainerState.ts` turns the cue states into what should be drawn: pedestal
  visibility, the checkpoint on the pedestal with its reveal/dissolve scale and
  turntable yaw, and the two counters. It is pure and tested against the real
  `cues.json`.
- `ExplainerScene` applies that state. It preloads every checkpoint at start-up as a
  hidden static splat through the renderer adapter, switches between them, and draws the
  pedestal and a billboarded counter panel.

The explainer loads after the player is ready. If its assets are missing, it logs a
warning and the presenter keeps playing without it.

Placement lives in `apps/6g-showcase/explainer/scene.json`:

| Field                                                       | Meaning                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetsUrl`                                                 | `explainer-assets.json` from `gs-content build-explainer`, relative to the page.                                                            |
| `stage.position`                                            | Stage origin on the floor beside the presenter, in world metres.                                                                            |
| `stage.yawDegrees`                                          | Stage rotation about world +Y; sets the object's resting orientation.                                                                       |
| `stage.pedestalHeight` / `pedestalRadius`                   | Pedestal size; the object stands on its top.                                                                                                |
| `stage.objectScale`                                         | Stage metres (the reconstruction) to world metres.                                                                                          |
| `counters.offset` / `counters.width`                        | Counter panel position above the pedestal top, and its width.                                                                               |
| `focus.position` / `focus.yawDegrees` / `focus.objectScale` | Close-up pose in front of the presenter, below the eye line to her face. The object glides there while a `demo-object.focus` cue is active. |
| `focus.countersOffset`                                      | Counter panel position relative to the close-up object base.                                                                                |

Environment overrides:

- `VITE_EXPLAINER_ASSETS_URL` replaces `assetsUrl`. When `SHOWCASE_LOCAL_DATASET_DIR`
  replaces Vite's public directory, either build the explainer assets into that
  directory or point this variable at them.
- `VITE_EXPLAINER_DEBUG=true`, or `#/demo?debug=1`, shows the debug panel: explainer
  time and frame, active cues, ±1 s, jump to any cue start, and toggles for the
  pedestal, demo object and counters. The panel is DOM-only, so it is not visible inside
  a headset.

Transparent explainer meshes are drawn in PlayCanvas's `UI` layer. Splats do not write
depth, so a transparent mesh in the world layer can be painted over by the environment.
Development builds expose `window.__showcase = { adapter, player }` for inspection.
