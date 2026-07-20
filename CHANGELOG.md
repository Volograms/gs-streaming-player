# Changelog

All notable changes to this project will be documented here. The project uses
[Semantic Versioning](https://semver.org/) once packages enter public release.

## [Unreleased]

### Added

- Babylon.js renderer adapter for neutral SPZ v4 frames, with worker-based conversion to
  Babylon's native splat memory, one persistent dynamic `GaussianSplattingMesh`,
  serialised asynchronous handoff, transforms, resource metrics, and explicit RAD
  rejection.
- Dedicated Babylon.js SPZ comparison demo sharing content configuration, byte caching,
  tier selection, decoded lookahead, and playback with the Spark demo while owning its
  engine, controls, diagnostics, and optional immersive-VR WebXR experience.
- Renderer-neutral demo-support package plus architectural decisions retaining Spark as
  a supported adapter, using dedicated per-engine demos, and re-scoping the pilot to
  client-measured testbed/Wi-Fi adaptation.
- Asynchronous renderer presentation support in player-core so a frame is not published
  as presented before a renderer-native mesh update completes.
- Renderer-neutral Gaussian codec contracts and registry, separating opaque compressed
  byte buffering from decoding and renderer-native packing.
- Official Niantic SPZ v4 worker decoder with persistent concurrency, transferable
  attribute arrays, pinned vendored WASM, and an explicit `spz-v4` content codec ID.
- Spark adapter packing from neutral Gaussian attributes into `PackedSplats`, with
  separate codec-decode and renderer-pack performance diagnostics.
- Persistent Spark-owned frame-packing workers with transferable neutral inputs and
  renderer-native outputs, independent packing concurrency, cancellation-safe worker
  replacement, and queue/worker/transfer/main-bind diagnostics.
- Opt-in Spark CPU sort keys for sole-source flat dynamic frames, retaining neutral
  centers through packing, preserving Spark's worker radix sort and ordering upload,
  reporting CPU-key time separately, and falling back to GPU readback for mixed splat
  mappings.
- Explicit `spark-spz-v3`/`spz-v4` demo selection for clean A/B testing, plus a content
  command that repacks existing flat quality tiers through the official SPZ v4 tools.
- Initial product and implementation plan.
- Milestone M0 pnpm workspace with independently buildable player, Spark renderer,
  telemetry, content-tool, shared, and demo packages.
- Strict TypeScript domain contracts for manifests, playback, quality, network state,
  and the renderer abstraction.
- React/Vite reference demo consuming all library packages through workspace APIs.
- ESLint, Prettier, Vitest coverage, Playwright smoke tests, and GitHub Actions quality
  gates.
- Architecture overview and six initial architecture decision records.
- Project TODO and decision tracking workflow.
- Versioned, TypeBox-authored sequence manifest contract with generated JSON Schema and
  semantic timeline validation.
- Cancellable manifest loading from URLs, parsed objects, blobs, and files, including
  manifest-relative asset URL resolution.
- `gs-manifest validate` content CLI with actionable JSON Pointer diagnostics and opt-in
  referenced-asset checks.
- Spark 2.1 renderer adapter with caller-owned canvas, scene, camera, and renderer
  support; managed resize/render loops; deterministic ownership; and clean disposal.
- Paged `.RAD` and GLTF/GLB loading paths with shared transforms, progress callbacks,
  cancellation, visibility control, retry-safe failure isolation, and resource release.
- Reference demo WebGL viewport with real Spark initialisation and a self-contained glTF
  mesh fixture covered by the Playwright smoke test.
- Optional local `.RAD` demo loading and Playwright assertion, validated with a real
  quality-LoD SH3 asset while keeping developer-provided content out of Git.
- Orbit, pan, zoom, damping, and touch-compatible camera navigation in the Spark demo
  viewport.
- Explicit `SparkFrameSlot` lifecycle with progress, cancellation, readiness,
  visibility, failure state, slot-backed frame switching, and deterministic GPU resource
  release.
- Validated Spark LoD configuration covering global budgets/scales, static and dynamic
  weights, per-object weights, foveation, and maximum spherical harmonics.
- Renderer diagnostics for in-flight resources, failures, prepared frames, rendered
  splats, GPU pages, frame time, and FPS, plus interactive demo quality controls.
- Explicit right-handed, Y-up player coordinate convention with content-owned axis,
  origin, scale, quaternion, and matrix alignment for static splats, dynamic frames, and
  meshes.
- Configurable local dynamic RAD range preview with eager preparation, 30 fps looped
  playback, manual frame stepping, source-frame diagnostics, and real Chromium
  validation against frames 40-50 of `rafa-pitch`.
- Framework-independent buffered-frame state and a configurable ring buffer with one
  presented frame, bounded future/previous ownership, base-first preparation, future
  refinement, cancellation, and deterministic eviction.
- Demo integration of the five-slot temporal buffer, keeping the current frame visible
  while a requested replacement reaches minimum playable quality.
- Renderer-neutral per-frame presentation-quality targets with Spark page-demand,
  upload, selected-splat, and mapping-stability inspection.
- Framework-independent sequence playback controller with an injectable monotonic clock,
  absolute 30 fps deadlines, startup reserve, pause/seek/loop controls, explicit
  buffering state, and dropped-frame accounting.
- Independent uniform-scale controls for the static scene and dynamic actor. Runtime
  scale changes preserve the capture-axis rotation, update prepared and future dynamic
  frames, and revalidate their Spark presentation readiness.
- Opt-in frame-buffer timing traces and a live demo diagnostic panel covering buffer
  window state, Spark resource/metadata/root-page milestones, range-transfer progress,
  LoD page demand, GPU upload queues, presentation readiness, handoff, and eviction.
- Deadline- and cost-aware base-frame scheduling with runtime-configurable preparation
  and refinement concurrency, plus queued/active preparation diagnostics.
- Multi-window client throughput estimation and a buffer-aware quality controller with
  conservative safety margin, immediate downgrade, delayed upgrade, and separate
  transfer/resident/render quality decisions.
- Live p50/p95 playback performance summaries and an opt-in real-asset Playwright
  benchmark that emits machine-readable switching measurements.
- Reproducible Spark 2.1 pager extension with cancellable explicit chunk preparation,
  persistent request priority through GPU readiness, and phase timers for chunk fetch,
  worker decode, preallocated page allocation/reuse, GPU upload, LoD-tree registration,
  tree update, and traversal.
- Offline dynamic RAD quality-cut extraction pinned to Spark 2.1, producing
  camera-independent, non-overlapping flat SPZ tiers and batch metadata with URLs, byte
  sizes, splat counts, and minimum-playable status.
- Optional per-tier asset URLs in manifest quality levels, including relative URL
  resolution and referenced-asset validation.
- Dynamic flat-SPZ playback through Spark `PackedSplats` with LoD disabled, including
  minimum-playable tier selection, fixed-tier achieved-quality reporting, decode/copy
  timing, and generated quality-index loading in the demo.
- Explicit dynamic SPZ transfer-tier controls showing selected and currently presented
  quality, with manual minimum/medium/full comparisons kept separate from Spark's
  dynamic render weight.
- Opt-in full-sequence dynamic preload mode that retains all configured frames and
  enables playback only after base preparation completes, for network-independent
  rendering measurements.
- Batched renderer diagnostics for presentation cadence, dropped frames, Three.js render
  calls, Spark update/generation, and actual Spark sort work, including p50/p95
  summaries in the demo.
- Stage-level Spark sort diagnostics separating GPU depth readback, worker sorting, and
  ordering-texture upload/submission.
- One grow-only GPU-facing `PackedSplats` allocation for flat dynamic playback; buffered
  SPZ frames now remain decoded on the CPU and copy into the shared display at handoff.
- Low-overhead demo diagnostics using a fixed-capacity trace buffer, four-Hz trace and
  playback-snapshot presentation, one-Hz performance summaries, stable trace rows, no
  per-event console output, and a production profiling command.
- Renderer-neutral, byte-budgeted compressed frame caching that fetches selected SPZ
  tiers independently of the five-frame decoded ring and supplies cached `fileBytes` to
  Spark only when a bounded decode slot is available.
- Demo defaults and controls for a 200 MB compressed reservoir, six concurrent fetches,
  four concurrent decodes, and a five-second adaptive target, with cache occupancy in
  the viewport.
- A ten-frame future decode lookahead in normal demo streaming, giving full-tier SPZ
  worker preparation enough lead time at the configured 30 fps playback rate.
- Separate compressed fetch/throughput and Spark decode-plus-worker-transfer summaries,
  plus observed Spark display-mapping commit cadence so player handoff rate is not
  mistaken for actual renderer presentation.
- An explicit packed-memory experiment for the currently presented flat frame, reporting
  renderer-native base/SH payload size, snapshot cost, full-buffer clone p50/p95, and
  zero-copy `PackedSplats` binding p50/p95 without introducing a persistent format.
- A living playback-performance report preserving test configurations, RAD and SPZ
  pipeline baselines, resident-versus-streaming results, Chrome trace attribution,
  packed-memory findings, current conclusions, and a repeatable result template.

### Fixed

- Compressed-frame prefetch now binds the browser `fetch` implementation to the global
  receiver, preventing `Illegal invocation` failures when the byte cache starts its
  forward network plan.
- Playback readiness now retries refinements cancelled or superseded by rolling-window
  policy and adaptive quality changes, preventing loop-boundary frames from turning a
  temporary buffer transition into a fatal dynamic-sequence error.
- Paged dynamic frames no longer become presentable at metadata initialisation or
  replace the active frame before their root LoD page is resident. Explicit Spark LoD
  invalidation also starts paging immediately after a visibility or refinement change,
  without requiring camera interaction.
- Dynamic frames no longer hand off at root-only quality or retain stale readiness after
  Spark page eviction. The active frame remains visible until the replacement's current
  presentation target is resident and stable.
- Requested detail is no longer treated as achieved detail, and the default presentation
  gate rejects the one-splat root representation that previously appeared as a grey
  cloud before Spark completed useful LoD selection. The current demo applies a
  content-specific 100-splat minimum.
- Demo playback no longer uses a drifting React interval or serialises frame rate behind
  async loads; timing and buffering now remain in the player core.
- Prefetched flat SPZ frames remain CPU-side instead of staying transparent-but-visible,
  preventing Spark from sorting and drawing the complete temporal window every render.
- Buffer readiness waits now follow a replacement SPZ preparation when adaptive quality
  changes the selected transfer tier, rather than surfacing the expected cancellation as
  a playback error.
- The formerly presented flat-SPZ slot is now replaced with the selected transfer tier
  after a safe frame handoff, preventing stale minimum-quality readiness from failing a
  later full-quality playback loop.
