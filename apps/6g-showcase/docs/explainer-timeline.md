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
