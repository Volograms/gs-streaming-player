# Project TODO

This file tracks implementation against the epics in
[`project-summary.md`](../project-summary.md). A task is checked only after its
acceptance criteria are covered by implementation and verification.

## Active implementation slice: Multi-renderer and multi-codec validation

### Renderer adapters and dedicated demos

- [x] Record Spark, Babylon.js, and PlayCanvas as co-equal renderer-adapter targets;
      retain Spark as a supported option rather than replacing it.
- [x] Choose dedicated renderer demos with shared renderer-neutral integration code
      instead of initialising multiple engines in one application.
- [x] Add a Babylon.js adapter for neutral SPZ v4 frames, including persistent dynamic
      mesh reuse, transforms, presentation readiness, resource ownership, and metrics.
- [x] Add a dedicated Babylon.js SPZ demo using the existing byte cache, playback
      controller, transfer-tier selection, and optional immersive-VR/WebXR entry.
- [x] Stabilise Babylon frame presentation with a two-slot depth-sort-fenced handoff so
      the old frame remains drawable until its replacement is ready; start the default
      orbit camera from the front of the current fixture.
- [ ] Measure the Babylon native-texture upload experiment at 25%, 50%, and 100% on
      desktop and Quest 3. It moves Babylon's per-splat covariance expansion out of the
      main-thread handoff; retain the documented `.splat` upload as an A/B fallback.
- [x] Add a renderer capability for direct compressed-frame preparation and fuse SPZ v4
      streaming decode with Babylon native-texture packing. Keep the neutral decoder as
      the fallback for Spark, other renderers, and Babylon compatibility tests.
- [x] Add feature-detected native half-float covariance writes to both Babylon native
      packing paths, retaining Babylon's JavaScript converter on older browsers.
- [ ] Measure fused versus neutral Babylon SPZ preparation at 25%, 50%, and 100%,
      including per-stage timing, peak memory/GC, prepared-frame throughput, mesh
      update, and presented cadence on desktop and Quest 3.
- [ ] Compare Babylon.js and Spark using identical SPZ v4 frames, cache state, worker
      limits, desktop hardware, and diagnostics.
- [x] Add a PlayCanvas adapter and dedicated demo using the engine's native SOG
      ingestion boundary. Keep SPZ out of this first comparison rather than silently
      expanding or transcoding it at runtime.
- [x] Add SOG v2 as a second runtime representation, including offline conversion of the
      existing quality-cut index and explicit `sog-v2` tier metadata; keep Babylon SOG
      support as a lower-priority follow-on.
- [x] Validate renderer/codec capability reporting so unsupported combinations fail
      clearly rather than silently selecting another path. Browser performance and
      stereo validation remain part of the device task below.
- [x] Add a strict PlayCanvas WebGPU experiment that verifies the selected backend,
      selects GPU sort, disables WebGL CPU-center generation before SOG loading, and
      reports the actual backend/sort path in the demo.
- [ ] Compare PlayCanvas WebGL2 CPU sort with WebGPU GPU sort at 25%, 50%, and 100% on
      the same desktop and Quest 3 sessions. Record SOG preparation, sort, cadence,
      memory, and traces without reducing source quality.
  - [x] Record the first desktop WebGPU full-tier screenshot: `webgpu`,
        `gpu (no CPU centers)`, `Sort 0.0 ms`, `Presented tier 1`, and smooth ~59 fps
        playback.
  - [x] Record the first Quest 3 WebGPU medium-tier screenshot: `webgpu`,
        `gpu (no CPU centers)`, `Sort 0.0 ms`, `Presented tier 0.5`, and acceptable but
        slower playback.
  - [x] Validate PlayCanvas XR on Quest 3 with the WebGL2 backend.
  - [ ] Capture repeated desktop and Quest 3 p50/p95 samples, including full-tier Quest
        traces and any WebGPU XR run that reports `XRGPUBinding`.
  - [ ] Test the opt-in WebGPU-to-WebGL XR mirror spike on Quest 3. Record mirror
        copy/draw cost, XR frame rate, visual latency, and whether mono mirroring is
        stable enough to justify a real stereo bridge.
    - [x] Capture the first successful Quest 3 mono handoff: the Canvas2D fallback
          displayed the dynamic 25% tier in both eyes at 1178 x 620, with a sampled 9.4
          ms copy/draw, 1.4 ms source render, and 24.5 mirror fps. The fixed mono view
          was expected; the configured static SOG failed to load in this run.
    - [x] Replace the incorrect per-eye camera conversion with PlayCanvas-native ordered
          XR views, a packed side-by-side WebGPU stereo render, one upload, and explicit
          left/right WebGL viewport routing. Quest validation remains open.
    - [x] Match the packed WebGPU source regions to the WebGL XR layer's native per-eye
          viewport dimensions instead of dividing the lower-resolution desktop canvas.
          Recheck visual artifacts and performance at the resulting resolution on Quest.
    - [x] Keep dynamic playback advancing during the mirror session by migrating its
          absolute deadlines between window timers and XR session animation frames, and
          drive the full PlayCanvas frame lifecycle from those XR frames.
- [ ] Run the chosen candidates on Meta Quest 3 and representative mobile Safari after
      desktop format/adapter comparisons have narrowed the device matrix.
  - [ ] Validate the Babylon streamed-splat stereo-buffer compatibility patch on both
        Quest 3 eyes during paused and continuous playback.

### Pilot network adaptation

- [x] Re-scope the final 6G epic: the pilot uses client-measured fetch throughput,
      latency, compressed-buffer state, stalls, and renderer capacity because its Wi-Fi
      last hop exposes no useful 6G-specific client telemetry.
- [ ] Calibrate safety margin and hysteresis for the expected sub-500-Mbps pilot path,
      using bytes per frame rather than splat count as the transfer constraint.
- [ ] Validate the generic adaptive policy over the 6G-testbed-plus-Wi-Fi path and
      document that it is client-measured rather than telemetry-assisted.
- [ ] Retain the normalised 6G telemetry provider as a deferred extension point without
      making it a pilot completion dependency.

## Previous implementation slice: Flat dynamic quality-tier playback

### Renderer-neutral codec boundary and SPZ v4 comparison

- [x] Add a renderer-neutral decoded Gaussian frame contract and codec registry without
      adding Spark or Three.js types to `player-core`.
- [x] Integrate Niantic's official SPZ v4 streaming decoder in a persistent browser
      worker pool and transfer decoded attribute buffers without cloning them back to
      the main thread.
- [x] Add a Spark renderer conversion layer that packs neutral attributes into
      `PackedSplats`, keeping the renderer-native representation outside the codec.
- [x] Keep legacy Spark SPZ v3 and neutral SPZ v4 as explicit, non-fallback demo paths
      for clean A/B tests and later legacy removal.
- [x] Split diagnostics into neutral codec decode, Spark adapter packing, and legacy
      Spark SPZ decode timings.
- [x] Move neutral-to-Spark packing into a persistent renderer-owned worker pool using
      transferable input/output buffers, a synchronous non-browser fallback, bounded
      concurrency, and separate queue/worker/transfer/main-bind timings.
- [x] Add an experimental flat-frame CPU sort-key provider that retains decoded centers,
      mirrors Spark's camera metric, reuses Spark's radix-sort worker and ordering
      upload, and automatically falls back to GPU readback for mixed Gaussian mappings.
- [x] Add an offline command that repacks the existing flat quality-cut index with the
      official SPZ v4 native tools and marks every output tier with `codec: "spz-v4"`.
- [ ] Measure v3 versus v4 throughput, worker utilisation, intermediate memory, and
      end-to-end 30 fps stability on the same hardware and tier set.
- [x] Add SOG v2 and a PlayCanvas renderer adapter through the existing compressed-byte
      and playback boundaries. Quest validation and comparative measurements remain in
      the active implementation slice above.

- [x] Integrate flat SPZ dynamic frames through Spark `PackedSplats` with LoD disabled,
      while retaining the existing paged RAD path for static scenes.
- [x] Resolve each frame's transfer URL from the quality-controller decision and its
      manifest `qualityLevels`, then prefetch the selected minimum-playable tier before
      presentation.
- [x] Expose explicit minimum/medium/full SPZ tier selection in the demo and report
      selected versus currently presented quality during safe buffer handoff.
- [x] Add an opt-in full-sequence preload mode for measuring playback/rendering without
      concurrent network transfers.
- [x] Measure presentation cadence, dropped frames, renderer call duration, Spark update
      duration, and Spark sort duration without logging on the display-frame hot path.
- [x] Keep buffered flat frames CPU-resident and copy the presented frame into one
      grow-only GPU-facing `PackedSplats` allocation, reallocating only when a frame
      exceeds its capacity.
- [x] Split Spark sort diagnostics into GPU depth readback, worker sorting, and ordering
      texture upload/submission timings.
- [x] Remove diagnostic observer overhead from performance runs by buffering trace
      events outside React, batching trace/snapshot/statistics presentation, suppressing
      console output, and documenting production-build profiling.
- [x] Decouple compressed SPZ fetching from the five-frame decoded ring with a
      byte-budgeted forward cache, independent fetch concurrency, and cached-byte Spark
      preparation.
- [x] Raise the demo's flat-frame decode concurrency to four, retain a configurable
      six-request network queue, and expose compressed occupancy/contiguous readiness.
- [x] Raise the normal decoded lookahead from three to ten future frames so the measured
      approximately 180 ms full-tier decode latency fits within the 30 fps presentation
      horizon.
- [x] Separate compressed fetch/throughput, Spark decode-plus-worker-transfer, shared
      display copy, and actual Spark display-mapping commit cadence in diagnostics.
- [x] Add a non-persistent packed-memory experiment that snapshots the active decoded
      frame into contiguous base/SH bytes and measures full-payload cloning separately
      from zero-copy `PackedSplats` binding before defining a runtime file format.
- [x] Start a living playback-performance report covering the paged RAD baseline, flat
      SPZ preparation, fully resident 30 fps presentation, bounded streaming, Chrome
      trace attribution, and renderer-native packed-memory experiment.
- [ ] Browser-validate 30 fps manual and clocked playback against the generated
      `rafa-pitch` tier set on a hardware-accelerated browser, then compare it with the
      paged RAD baseline. Headless Chromium's software WebGL path reports 0 fps for a
      single approximately 70k-splat frame and is not a useful throughput benchmark.

Full-sequence hardware measurements now reach a stable 30 fps at both minimum and full
quality once all bytes are resident. The 200 MB compressed stage separates fetching from
decode, and the normal window now looks ten frames ahead so the measured approximately
180 ms full-tier decode latency fits inside its 30 fps presentation horizon. Hardware
validation of sustained streaming is the next measurement. A browser trace showed that
unbatched development diagnostics could consume roughly half the main-thread capture, so
subsequent hardware figures must use the production profiling command and the batched
diagnostics path.

The packed-memory experiment is deliberately not a format implementation. It runs on the
currently presented flat frame, reports its renderer-native uncompressed size, and
compares byte ownership with synchronous zero-copy construction. Its hardware results
will determine whether a versioned renderer-native payload is justified.

The offline source path is now fixed and consumed by the runtime. Quality-LoD RAD is
decoded once during content preparation, valid camera-independent frontiers are exported
as flat SPZ files, and the buffer selects the smallest minimum-playable-or-better tier
for its current network quality target. Remaining work focuses on the measured sort
bottleneck and real 30 fps validation.

## Parallel validation and composition work

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
- [x] E06-T03/E07-T08 follow-on — Replace dynamic paged-RAD preparation with selection
      and loading of one flat SPZ quality tier. Offline cut generation, manifest-level
      URL/size metadata, runtime tier selection, non-LoD presentation, shared GPU reuse,
      and independent compressed buffering are complete. Hardware measurements remain
      under E03-T05.
- [ ] E13-T02/T04 — Complete the target-device renderer budget matrix and add
      independent static-refinement concurrency. Dynamic base and refinement concurrency
      are now configurable and measured.

## Completed

### Flat SPZ dynamic runtime path (2026-07-16)

- [x] Select the smallest independently addressable tier satisfying the current dynamic
      detail target, with the configured minimum-playable tier as a floor.
- [x] Load fixed tiers through Spark's non-paged `PackedSplats` path with LoD disabled.
- [x] Keep decoded frames transparent through a render fence before marking base
      preparation complete.
- [x] Park uploaded future flat frames as invisible resources so Spark does not sort or
      draw the complete temporal window on every render.
- [x] Report the tier's actual detail, splat count, byte size, decode duration, and
      render-fence duration through existing buffer diagnostics.
- [x] Load generated `quality-cuts.json` metadata in the demo while retaining per-frame
      RAD as an optional fallback and retaining paged RAD for static objects.
- [x] Retry callers waiting on a queued flat frame when an adaptive-quality change
      replaces that frame with another transfer tier.

### Offline flat dynamic quality cuts (2026-07-16)

- [x] Decode existing quality-LoD RAD frames with a reproducibly pinned Spark 2.1 Rust
      library.
- [x] Generate configurable, non-overlapping camera-independent frontiers by leaf-count
      ratio.
- [x] Convert merged-node LoD opacity for flat rendering and export independent SPZ
      assets with no child tree.
- [x] Emit batch quality metadata containing tier URLs, byte sizes, splat counts, and
      the minimum-playable tier.
- [x] Extend manifest quality levels with optional tier URLs, including relative URL
      resolution and referenced-asset validation.

The real 7.2 MB SH3 RAD fixture decoded in approximately 102 ms in a release smoke run.
With SH disabled for that run, its 25% frontier encoded to 377 KB and its leaf-only full
tier to 1.48 MB. These are pipeline sanity figures, not final dynamic-sequence quality
or compression measurements.

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
moves. The demo uses four base preparations and one refinement by default. Automatic
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

The isolated Chromium test loads the bounded decoded window, switches Next/Previous,
starts the absolute-deadline playback controller, observes frame advancement, and pauses
again in about five seconds against frames 40-50.

Readiness waits also survive refinement cancellation when the rolling window wraps or
adaptive quality changes its target. Superseded work is retried against the current
target, while genuine renderer failures still move playback to `ERROR`.

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
