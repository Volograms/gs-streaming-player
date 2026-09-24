# Changelog

All notable changes to this project will be documented here. The project uses
[Semantic Versioning](https://semver.org/) once packages enter public release.

## [Unreleased]

### Changed

- Emit compact manifest `1.1` JSON with shared sequence codec and quality defaults,
  implicit frame indices and fallback URLs, and optional regular timing derived from
  FPS. Keep `1.0` readable and add `gs-manifest convert-manifest` to upgrade existing
  datasets without encoding assets again, preserving irregular timing and measured
  per-frame data.
- Load workspace source aliases explicitly in `gs-content` and `gs-manifest` so content
  preparation works without previously built package `dist` files.
- Generate compressed prefetch requests lazily so long sequences are inspected only
  until the cache budget is filled. Use observed sizes for resident assets and bound
  speculative lookahead when byte-size metadata is missing.
- Make automatic dynamic quality use the manifest's actual tier ladder and byte costs,
  with reachable buffer thresholds, timed upgrades through full quality, and downgrades
  under network or presentation pressure. Preserve prepared frames during automatic
  switches, aggregate overlapping downloads, and exclude known cached/stale throughput
  evidence.
- Keep audio and frame presentation synchronized across loops, seeks, audio starvation,
  and splat buffering, including non-frame-aligned audio offsets. Cancel pending audio
  starts on transport changes, preserve mute/volume during silent priming, expose media
  failures in player snapshots and the showcase, and release media resources on
  disposal.
- Make `gs-content build --force` replace only dataset-owned output entries with
  rollback protection, preserving unrelated files instead of deleting the complete
  output directory.
- Schedule dynamic-frame presentation and buffering from manifest timestamps, and keep
  the final frame active until the selected sequence duration elapses.
- Cancel Babylon frame handoffs when their prepared frame is released, reject pending
  compressed-frame reads on cache disposal, and validate all adaptive-quality numeric
  configuration.
- Raise the minimum Node.js version to 22.13 and let GitHub Pages use the current
  Node.js 22 release so the pinned pnpm version can start successfully.

### Removed

- The abandoned WebGPU-to-WebGL XR bridge, including its runtime flag, controls,
  metrics, and presenter. Its historical result remains in the performance record.

### Added

- A dedicated `pnpm dev:showcase:https` mode for local WebXR testing. It uses the
  ignored mkcert key pair, binds the showcase to the LAN, enables XR, and retains local
  dataset settings from `apps/showcase/.env.local`.

- A compact automatic/manual dynamic quality selector in the showcase, plus independent
  build-recipe transforms with XYZ position, degree-based Euler rotation, and uniform or
  non-uniform scale for dynamic sequences and static objects.

- Public PLY/SPZ dynamic-tier authoring through SplatTransform merge decimation. The
  normal `gs-content build` now emits bundled SOG tiers by default or SPZ v4 tiers on
  request, discovers large input sequences from a directory, records actual output
  metadata, processes frames with bounded CPU-aware parallelism (configurable in the
  recipe or via `build --frame-workers`), supports a `build --max-workers` SOG encoder
  override, and leaves the RAD extractor as a legacy command with focused tests.

- Local showcase datasets can be served directly from an external directory with
  `SHOWCASE_LOCAL_DATASET_DIR`, while relative manifest paths and the existing ignored
  `public/assets` convention remain supported. The showcase now uses the Volograms
  black, pink, violet, and blue visual palette.

- A source-only Volograms 4DGS public preview: `GaussianStreamingPlayer`, audio-backed
  timing, adaptive PlayCanvas render budgets, a landing/player showcase with Quest XR
  transport controls, the `gs-content build` dataset pipeline, Pages deployment, and
  focused integration/content/hosting/support documentation.

- PlayCanvas Quest tuning controls for pre-sort minimum pixel size and projected
  contribution, forward alpha clipping, splat-level and XR fixed foveation, plus an
  explicit WebGPU CPU-sort A/B mode. Diagnostics report the selected sorter, retained
  CPU centers, accepted XR foveation, and unified GSplat work-buffer copies separately
  from steady-state sorting.

- A `gs-content export-sog-lod` command that derives configurable coarse levels from one
  source scene and exports PlayCanvas's spatially chunked Streamed SOG `lod-meta.json`
  layout with bounded encoder workers.
- PlayCanvas static-only operation when no dynamic quality index is configured, while
  retaining renderer metrics and WebXR entry for isolated Quest scene measurements.
- PlayCanvas Streamed SOG benchmark controls for a pinned static LOD level or global
  splat budget, with the diagnostics reporting the unified renderer's actual splat
  count.
- Quest-oriented PlayCanvas streaming diagnostics separating response latency,
  response-body/`ArrayBuffer` time, overlapping aggregate throughput, preparation queue
  delay, native SOG asset loading, presentation cadence, buffering episodes, and
  main-thread event-loop pressure with bounded rolling samples. Browser Resource Timing
  also reports the negotiated network protocol and connection setup/reuse.
- A one-shot PlayCanvas static-SOG load benchmark reporting payload and wire sizes,
  response and body timing, effective throughput, cache status, protocol, and native
  processing time for large-file delivery comparisons.
- PlayCanvas demo static-scene placement now accepts signed uniform scales and an
  explicit `VITE_STATIC_GS_ROTATION_X_DEGREES` orientation correction. A responsive
  position panel and separate `VITE_STATIC_GS_POSITION_X/Y/Z` and
  `VITE_DYNAMIC_GS_POSITION_X/Y/Z` defaults independently place the static and dynamic
  GS objects in the world.
- Low-overhead PlayCanvas WebGPU timing samples with rolling GPU-frame and named-pass
  p50/p95 diagnostics in the demo UI, including explicit timestamp-query capability
  reporting and unattributed transfer time.
- Standalone static SPZ-to-SOG conversion through `gs-content convert-sog`, alongside
  the existing dynamic quality-cut index conversion.
- Strict, opt-in PlayCanvas WebGPU initialisation for GPU-sort SOG measurements. The
  adapter rejects silent WebGL2 fallback, selects PlayCanvas's GPU Gaussian sorter,
  disables CPU-center generation before asset loading, and exposes the actual graphics
  backend and sort path in the PlayCanvas demo diagnostics.
- PlayCanvas XR diagnostics now distinguish browser/session failures from missing WebGPU
  `XRGPUBinding`, and the demo can explicitly fall back to WebGL2 for XR with
  `VITE_PLAYCANVAS_XR_BACKEND_FALLBACK=true`.
- Quest 3 setup documentation now records the three browser flags required by the
  validated native WebGPU-WebXR path: WebXR/WebGPU Binding, WebXR Projection Layers, and
  WebXR Experiments.
- Native PlayCanvas SOG v2 playback through a dedicated renderer adapter and demo. The
  adapter consumes compressed SOG bytes from the player-owned cache, creates
  PlayCanvas-native assets without an expanded neutral Gaussian frame, reuses one
  persistent dynamic entity, and exposes optional immersive-VR entry for Quest testing.
- Offline conversion of existing flat SPZ quality-cut indexes into explicitly tagged SOG
  v2 frame tiers for the PlayCanvas comparison path. The selected tier detail and
  splat-count metadata are preserved; runtime fallback or transcoding is not used.
- Feature-detected native `Float16Array` covariance encoding in Babylon's native-texture
  packers, with the existing Babylon truncating converter retained for older runtimes.
  The native path writes through a shared view of the final `Uint16Array` texture bytes
  and avoids six JavaScript table conversions per splat.
- Fused Babylon SPZ v4 preparation: player-core can now route supported compressed
  frames directly to an adapter, and Babylon's packing worker streams decoded chunks
  into final center, covariance, RGBA, and SH texture arrays. The neutral Float32 frame
  and second worker handoff are bypassed without changing tier, splat count, SH, or the
  existing neutral fallback. Codec-internal allocation, copy, WASM, attribute-write, and
  result-transfer timing phases are also exposed for A/B profiling.
- Use a 25% dynamic-transfer floor in the comparison demos and their adaptive policy,
  while retaining 10% preview cuts in the manual controls for diagnostic comparisons.
- Experimental Babylon direct native-texture packing for neutral SPZ frames. Covariance
  expansion now runs in the renderer-owned packing worker and the adapter submits the
  resulting texture layout to Babylon's existing sort/upload path, avoiding
  `updateDataAsync()`'s per-splat main-thread conversion. Set
  `VITE_BABYLON_NATIVE_TEXTURE_PACKING=false` for the documented `.splat` fallback and
  A/B measurements; transfer tier and source quality are unchanged.
- Register Babylon.js pointer-selection, near-interaction, hand-tracking, ray, and
  instanced-mesh side effects so the default WebXR experience can initialise its
  controller interactions; stop requesting unrelated AR-only optional features for the
  immersive-VR demo.
- Patch Babylon.js Gaussian splat depth-sort publication so a completed streamed-frame
  ordering updates every per-camera instance buffer, preventing one XR eye from
  retaining stale or zero indices while the other eye displays the frame.
- Babylon.js renderer adapter for neutral SPZ v4 frames, with worker-based conversion to
  Babylon's native splat memory, two persistent front/back `GaussianSplattingMesh`
  slots, depth-sort-fenced asynchronous handoff, transforms, resource metrics, and
  explicit RAD rejection.
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

- Vitest now resolves every internal workspace package directly from source, so clean CI
  checkouts can run unit tests before package build artifacts exist.
- PlayCanvas transform tests now supply their entity's required application context,
  avoiding misleading assertion diagnostics during otherwise successful test runs.
- PlayCanvas playback no longer remains indefinitely in `initialising` after its first
  SOG frame becomes visible. Normal frame swaps no longer depend on the diagnostic
  `frame:ready` capture fence; the opt-in fence now matches the emitted camera component
  correctly and has a finite timeout.
- Babylon frame changes no longer overwrite the visible Gaussian mesh while its
  replacement textures and first valid depth ordering are pending. The adapter swaps two
  persistent mesh slots atomically at a render boundary, and its default orbit camera
  now starts on the front side of the current dynamic fixture.
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
