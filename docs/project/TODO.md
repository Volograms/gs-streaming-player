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
      root chunk fetch/decode, page allocation/reuse, GPU upload, tree registration,
      tree update/traversal, refinement progress, the presentation gate, handoff, and
      eviction. The demo now calculates p50/p95 stage distributions and an opt-in
      Playwright benchmark records a machine-readable summary. A local desktop run with
      two base preparations measured root-ready p50/p95 at 1.45/3.37 seconds, refinement
      at 0.48/1.21 seconds, and handoff at 0.10/0.20 milliseconds; sustained
      device-matrix runs and maximum stable playback-rate measurements remain.
- [ ] E05-T02/T08 — Add media-element and audio-master clocks. The monotonic injectable
      clock and deterministic test clock are now implemented.
- [ ] E05-T03/T06/T07 — Complete timestamp-based selection, playback-rate support, and
      the public event model beyond observable state snapshots.
- [ ] E06-T06/T09 — Complete independent in-flight refinement cancellation and memory
      budget integration beyond frame-count eviction.
- [ ] E06-T03/E07-T08 follow-on — Generate camera-independent logical quality cuts for
      dynamic RAD frames so network policy can select required chunks and draw indices
      without runtime camera-driven tree traversal. Spark's explicit chunk preparation
      API and phase timing foundation is complete; the offline cut format and runtime
      index remapping remain.
- [ ] E13-T02/T04 — Complete the target-device renderer budget matrix and add
      independent static-refinement concurrency. Dynamic base and refinement concurrency
      are now configurable and measured.

## Completed

### Explicit Spark page preparation and phase timing (2026-07-15)

- [x] Add a reproducible Spark 2.1 patch exposing cancellable `prepareChunk()`.
- [x] Keep explicitly requested dynamic root chunks pinned in pager priority until their
      preallocated GPU page upload completes.
- [x] Measure root fetch, worker decode, page allocation/reuse, GPU upload, shared-tree
      registration/update, and traversal separately in the playback trace.

Spark retains its shared preallocated page textures. Normal dynamic turnover consumes a
free page or reuses an evicted page; it does not allocate a new per-frame GPU buffer.
The GPU-upload timer includes lazy SH texture creation, making first-use allocation
costs visible. Trace emission is limited to the first observation of each phase/chunk
for a frame so render-loop traversal does not flood diagnostics.

### Deadline-aware scheduling and adaptive quality foundation (2026-07-15)

- [x] E06-T04 — Implement minimum-quality-first prefetch scheduling.
- [x] E06-T05 — Track deadlines, temporal distance, estimated bytes, and preparation
      concurrency.
- [x] E07-T01/T02 — Provide the quality-controller boundary and fixed manual baseline.
- [x] E07-T04 — Add a conservative multi-window client throughput estimator.
- [x] E07-T05/T06/T07 — Add buffer-aware decisions, a safety margin, and immediate-down
      / delayed-up hysteresis.
- [x] E07-T08 — Separate requested, resident, and achieved rendering quality.

The preparation scheduler bounds concurrent Spark frame creation and reprioritises
queued work by temporal distance, deadline, and estimated byte cost whenever the window
moves. The demo uses two base preparations and one refinement by default. Automatic
quality is opt-in and adjusts presentation detail, render budget, static weight, and
base/refinement concurrency using measured throughput, buffer occupancy, and render FPS.

Requested LoD is no longer accepted as achieved LoD. The library default requires at
least two selected splats and the current demo requires 100, preventing a single root
splat from being reported as a 25% frame. The gate remains configurable for measured
content profiles.

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
