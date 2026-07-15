# Project TODO

This file tracks implementation against the epics in
[`project-summary.md`](../project-summary.md). A task is checked only after its
acceptance criteria are covered by implementation and verification.

## Active implementation slice: Temporal buffering and scene composition

- [ ] E03-T01 — Complete visual alignment validation for the composed static GS, dynamic
      GS, and mesh scene. The real assets now load and switch together, and independent
      static-scene and dynamic-actor scale controls are available for calibration; final
      origin and floor alignment still require visual confirmation.
- [ ] E03-T04 — Validate dynamic alpha and background masking behaviour.
- [ ] E03-T05 — Measure dynamic switching performance. An opt-in monotonic playback
      trace now separates Spark resource initialisation, metadata, root-page readiness,
      refinement fetch/upload progress, the presentation gate, handoff, and eviction;
      capture and analyse a sustained real-asset run next.
- [ ] E05-T02/T08 — Add media-element and audio-master clocks. The monotonic injectable
      clock and deterministic test clock are now implemented.
- [ ] E05-T03/T06/T07 — Complete timestamp-based selection, playback-rate support, and
      the public event model beyond observable state snapshots.
- [ ] E06-T04/T05 — Extend the base-first buffer scheduler with request cost estimates,
      per-request priorities, deadline-aware ordering, and network-selected quality
      targets. The isolated five-frame real-asset Chromium check now completes in about
      five seconds; the demo now exposes the per-frame timing evidence needed for
      sustained playback profiling.
- [ ] E06-T06/T09 — Complete independent in-flight refinement cancellation and memory
      budget integration beyond frame-count eviction.

## Completed

### Stable presentation and playback clock foundation (2026-07-15)

- [x] E05-T01 — Implement the explicit playback state machine foundation.
- [x] E06-T03 — Define and enforce minimum viable frame quality.
- [x] E06-T08 — Hold the current frame and enter `BUFFERING` when required quality is
      unavailable.

Presentation readiness now means a configurable spatial target is resident, uploaded,
and stable across Spark render turns; root residency alone is only base readiness. Every
handoff revalidates the renderer because the shared page pool may evict a formerly ready
frame. The player-core playback controller uses absolute monotonic deadlines, prebuffers
two presentation-ready frames, emits `PLAYING`/`BUFFERING`/`PAUSED` states, and keeps
the old frame visible on a miss. Deterministic tests exercise 30 deadlines per second,
startup buffering, missed-frame hold, and pause cancellation.

The isolated Chromium test loads the five-frame window, switches Next/Previous, starts
the absolute-deadline playback controller, observes frame advancement, and pauses again
in about five seconds against frames 40-50.

### E06 bounded temporal buffer foundation (2026-07-15)

- [x] E06-T01 — Define observable buffered-frame state.
- [x] E06-T02 — Implement a configurable, bounded frame ring buffer.

The demo now owns only the current frame, three future frames, and one previous frame.
It presents the current frame only after the configured presentation target is stable,
fills the rest of the window in the background, and enables future refinement after base
preparation. Seeking preserves the displayed frame until its replacement is
presentation-ready. Unit tests cover base-first refinement, bounded ownership,
cancellation, eviction, and non-adjacent seeks. Real Chromium validation requested
exactly frames 40-43 and 50 for the initial looped window and switched Next/Previous
without camera interaction.

### E03 coordinate and alignment foundation (2026-07-15)

- [x] E03-T02 — Define and document the player coordinate-system conventions.
- [x] E03-T03 — Apply translation, quaternion rotation, scale, and matrix alignment to
      static splats, meshes, and every dynamic frame.

The demo composes the persistent mesh and optional static RAD with an opt-in local
dynamic range. Chromium decoded frames 40-50 of `rafa-pitch` and switched forward and
backward without recreating the scene. Final E03-T01 completion awaits visual
confirmation of origin and floor alignment. Separate uniform-scale controls now adjust
the static scene and dynamic actor around their respective local origins while
preserving the shared capture-axis rotation. A dynamic scale change propagates to
already prepared buffered frames and frames prepared later, and invalidates stale
presentation-readiness results so the affected frames are checked again before handoff.

Paged-frame readiness requires Spark chunk 0 to be resident rather than relying on
`SplatMesh.initialized`, preventing presentation from switching to a frame with no
drawable page.

### M1 dynamic renderer foundation (2026-07-14)

- [x] E02-T05 — Implement `SparkFrameSlot` dynamic frame representation.
- [x] E02-T06 — Integrate manual dynamic frame switching with frame slots.
- [x] E02-T07 — Expose the full Spark LoD and foveation controls.
- [x] E02-T08 — Complete renderer and resource metrics.

### M1 asset-independent renderer foundation (2026-07-14)

- [x] E02-T01 — Finalise the renderer adapter API against Spark requirements.
- [x] E02-T02 — Implement Spark renderer initialisation.
- [x] E02-T03 — Load and browser-validate static `.RAD` objects.
- [x] E02-T04 — Load conventional GLTF/GLB meshes.

The static loader's progress reporting, transforms, visibility, failure isolation,
cancellation, and disposal are unit covered. A local 6.9 MB quality-LoD `.RAD` asset was
also decoded and initialised through Spark in the Chromium smoke test.

### Content manifest foundation (2026-07-14)

- [x] E01-T01 — Define the versioned sequence manifest schema.
- [x] E01-T02 — Implement the manifest loader.
- [x] E01-T03 — Implement the manifest validator CLI.

### M0 — Repository Ready (2026-07-14)

- [x] E00-T01 — Initialise the pnpm monorepo.
- [x] E00-T02 — Configure strict TypeScript.
- [x] E00-T03 — Configure ESLint, Prettier, and import ordering.
- [x] E00-T04 — Configure Vitest unit testing.
- [x] E00-T05 — Configure Playwright browser integration testing.
- [x] E00-T06 — Configure the GitHub Actions CI pipeline.
- [x] E00-T07 — Record the initial architecture decisions.

## Inputs needed for M1/M2 validation

- [x] Obtain representative static `.RAD` content (local-only; licensing still pending).
- [x] Obtain at least ten dynamic `.RAD` frames (frames 40-50 of `rafa-pitch`,
      local-only).
- [ ] Obtain a representative production GLB mesh (a minimal glTF test marker is
      committed).
- [ ] Record asset licensing and whether fixtures may be committed.
- [x] Record the known axis conversion and outstanding scale/origin calibration in
      `docs/coordinate-system.md`.
