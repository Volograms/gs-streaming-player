# Project Decisions

Architecture decisions are recorded as ADRs in
[`docs/architecture/decisions`](../architecture/decisions). This file is the short index
used during day-to-day implementation.

| ADR  | Decision                                            | Status   |
| ---- | --------------------------------------------------- | -------- |
| 0001 | Use a pnpm workspace monorepo                       | Accepted |
| 0002 | Isolate renderers behind a core adapter             | Accepted |
| 0003 | Use one `.RAD` asset per dynamic frame initially    | Accepted |
| 0004 | Inject adaptive quality policy                      | Accepted |
| 0005 | Make the sequence manifest player-owned             | Accepted |
| 0006 | Normalise network telemetry behind a provider       | Accepted |
| 0007 | Keep coordinate conversion in content transforms    | Accepted |
| 0008 | Gate presentation quality and use an absolute clock | Accepted |
| 0009 | Export flat dynamic quality tiers from RAD trees    | Accepted |
| 0010 | Separate compressed and decoded frame buffers       | Accepted |
| 0011 | Separate Gaussian codecs from renderer adapters     | Accepted |
| 0012 | Support multiple renderer adapters and demos        | Accepted |
| 0013 | Use client-measured network state for the pilot     | Accepted |
| 0014 | Use native PlayCanvas SOG ingestion                 | Accepted |

## Working conventions

- Node.js 22 is the development and CI baseline.
- pnpm is pinned through the root `packageManager` field.
- Dependency install scripts are denied by default; only reviewed build tools listed in
  `pnpm-workspace.yaml` may run them.
- TypeScript remains on the current 6.x line until the typed ESLint toolchain supports
  TypeScript 7.
- The demo uses React and Vite, while published player packages remain
  framework-independent.
- Initial npm package names use the `@6g-path` scope. Publication ownership is confirmed
  before the first public release.
- The manifest's TypeBox definition is the source of truth; the committed JSON Schema is
  generated from it and protected by a synchronisation test.
- Manifest diagnostics identify fields using JSON Pointer paths. Referenced-asset checks
  are opt-in so structural and semantic validation does not require local media assets.
- The initial concrete renderer baseline is Spark 2.1.0 with Three.js 0.180.0.
- Renderer ownership is explicit: caller-owned scenes, cameras, and renderers survive
  adapter disposal; adapter-created and adapter-loaded resources do not.
- Manifest transforms are applied identically to splats and meshes. Matrices use
  Three.js column-major ordering, take precedence over components, and receive no
  implicit coordinate-system conversion.
- The player world is right-handed and Y-up. Source-axis conversion is explicit asset
  configuration, including the current fixtures' 180-degree X rotation; it is never a
  renderer-wide RAD default.
- Runtime object-scale calibration is a uniform local transform applied independently to
  the static scene and dynamic actor. It preserves the configured source-axis rotation;
  dynamic changes propagate across prepared and future buffered frames and force
  presentation-readiness revalidation.
- Dynamic Spark resources are owned by explicit frame slots; presentation changes slot
  visibility, while release or cancellation disposes the slot's mesh without recreating
  the scene.
- A prepared paged frame must have its root LoD page resident, but this is only base
  readiness. A frame is presentation-ready after its configured spatial-quality demand
  is resident and stable. Inactive buffered slots remain transparent, and readiness is
  revalidated immediately before handoff because Spark may evict pages later.
- The initial temporal buffer owns one presented frame, three future frames, and one
  previous frame. The window size is configurable, base quality has priority over
  refinement, and a replacement never evicts the presented frame before it is
  presentation-ready.
- Spark-specific LoD and foveation settings remain on the concrete adapter. The core
  quality decision is translated at the boundary so Spark properties do not leak into
  `player-core`.
- Playback uses absolute deadlines from a monotonic, injectable clock. A missing
  presentation-ready frame holds the current frame and enters `BUFFERING`; the initial
  no-audio clock pauses media time across that stall.
- Playback tracing is opt-in and uses the same monotonic clock. Core events remain
  renderer-neutral while adapters may report preparation milestones; observer failures
  never affect playback.
- Requested frame detail, resident data, and achieved presentation detail are separate
  states. A requested LoD value is never evidence that Spark has produced a useful
  frame.
- Dynamic base work is queued by temporal distance, deadline, then estimated byte cost;
  preparation and refinement concurrency remain runtime-configurable policy outputs.
- The current RAD hierarchy is an authoring source for dynamic quality tiers, not the
  intended runtime representation. The content pipeline expands valid non-overlapping
  frontiers and exports each as flat SPZ with manifest-compatible quality metadata.
- Dynamic quality is network/deadline selected rather than camera selected. Dynamic SPZ
  tiers use Spark `PackedSplats` without LoD; static scenes retain paged, camera-aware
  RAD LoD.
- Flat tiers remain decoded in CPU memory while buffered. Exactly one grow-only
  `PackedSplats` mesh is GPU-facing; handoff copies the chosen frame into that
  allocation and only grows it when capacity is insufficient. Every handoff still
  invalidates the mapping and requests a new sort because independently encoded frames
  do not guarantee corresponding splat order.
- Flat-tier network buffering is a separate byte-budgeted stage ahead of decoded frame
  ownership. The demo keeps up to 200 MB of selected compressed SPZ payloads, fetches
  them independently, and only occupies a bounded Spark worker slot after complete bytes
  are resident. The normal demo window retains one previous frame and looks ten frames
  ahead so measured decode latency fits inside the presentation horizon.
- Manual dynamic transfer quality selects a content tier by its declared detail ratio,
  independently of Spark's dynamic render weight. A tier change refills future slots and
  preserves the current frame until a replacement is presentation-ready.
- Renderer diagnostics batch display cadence, render-call duration, flat-frame CPU copy,
  Spark update, and sort duration approximately twice per second. Sort timings
  separately report GPU depth readback, worker sorting, and ordering texture
  upload/submission. This keeps React state updates and console tracing off the
  per-frame render hot path while preserving enough samples for p50/p95 analysis.
- Demo trace events are retained in a fixed-capacity non-React buffer. The newest trace
  view refreshes no more than four times per second, statistical summaries refresh once
  per second, playback snapshots are presentation-throttled, and normal runs do not log
  events to the console. Performance captures use a production build so development
  React instrumentation is not mistaken for player or renderer cost.
- Separate tier files are accepted for the first measurable version. A packed
  multi-frame container and temporal compression remain a later optimisation after the
  flat-tier playback baseline is measured.
- Compressed-byte streaming, Gaussian decoding, and renderer-native packing are separate
  boundaries. Content selects a codec explicitly; the first neutral path uses official
  Niantic SPZ v4 and the first renderer sink is Spark `PackedSplats`.
- Renderer-native packing concurrency belongs to the renderer adapter. Neutral decoded
  typed arrays transfer ownership into persistent Spark packing workers, which return
  renderer-native typed arrays by transfer; only lightweight `PackedSplats` binding
  remains on the main thread. Codec and packing worker counts are independently
  configurable so measurements do not conflate the two stages.
- CPU sort keys are an explicit Spark-adapter experiment, not part of the neutral codec
  contract. The Spark adapter may retain decoded centers and an active mask alongside a
  flat buffered frame. It supplies keys only when that frame is the complete active
  Gaussian mapping; persistent/mixed Gaussian scenes automatically use Spark's original
  GPU readback. The library default remains GPU readback while the demo defaults to the
  CPU experiment for current flat-sequence measurements.
- The legacy Spark-owned SPZ v3 loader remains an explicit A/B compatibility path. It
  does not act as an implicit fallback for SPZ v4 content, so the entire legacy route
  can be removed cleanly after comparison.
- Spark, Babylon.js, PlayCanvas, and later renderers are co-equal adapter packages.
  Spark remains supported for its existing flat-SPZ and paged-RAD use cases. Each engine
  has a dedicated demo and optional XR entry point instead of loading multiple engines
  into one comparison application.
- Babylon dynamic presentation uses two persistent front/back mesh slots. The current
  frame remains visible while the other slot uploads and reaches a settled Babylon depth
  sort, then both visibility flags change at one render boundary. This bounded extra GPU
  allocation is preferred to a blank or partially ordered frame and must be included in
  Quest/mobile memory measurements.
- Babylon's dynamic 25%+ path may precompute its final covariance/texture payload in a
  renderer-owned worker and submit it through Babylon's existing texture/sort machinery.
  This removes the repeated main-thread `.splat` expansion but is guarded by an explicit
  fallback because the texture hooks are internal to Babylon. It is an adapter-specific
  optimisation, not a change to neutral SPZ decoding, player-core buffering, or content
  quality selection.
- Renderer adapters may advertise direct support for a compressed codec when a fused
  decode-to-native path avoids a large neutral intermediate. The player still owns
  fetching, caching, scheduling, and fallback selection; the shared SPZ streaming core
  remains codec-owned, while final texture/buffer packing remains renderer-specific.
  Babylon is the first implementation. Spark and future renderers keep the neutral path
  until their own measured native sink justifies equivalent work.
- The first SOG v2 path uses PlayCanvas's native WebP-backed asset ingestion. The
  adapter explicitly accepts `sog-v2` compressed frames from the player-owned byte cache
  and avoids a renderer-neutral expanded frame. Existing SPZ tiers are converted offline
  without changing their declared detail target; unsupported renderer/codec combinations
  fail instead of transcoding or falling back at runtime.
- Demo and pilot playback use a 25% dynamic transfer floor. A 10% preview asset remains
  available through the manual demo controls for diagnostics, but is not selected by the
  initial or buffer-aware policy.
- The 6G pilot uses completed-transfer throughput, request timing, buffer state, stalls,
  and renderer capacity for adaptation because its Wi-Fi last hop exposes no useful
  6G-specific client telemetry. The normalised 6G provider remains an extension point,
  but the pilot does not claim a telemetry-assisted policy.
- Renderer-native packed frame storage remains an experiment until its measured
  clone/bind cost is compared with SPZ decoding. The benchmark uses an ephemeral
  contiguous payload and does not establish a file header, manifest contract, or stable
  dependency on Spark's memory layout.
- Spark 2.1 is extended through a committed pnpm patch, not ad-hoc `node_modules` edits.
  The extension preserves Spark's shared preallocated GPU page pool, exposes cancellable
  explicit chunk preparation, and reports fetch, decode, page reuse/upload, and LoD-tree
  phase timings. A full custom renderer remains unnecessary unless measurements show
  this boundary cannot meet playback deadlines.
