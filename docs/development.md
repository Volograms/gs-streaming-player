# Development Guide

## Toolchain

The workspace requires Node.js 22.12 or newer and uses the exact pnpm release in the
root `packageManager` field. With Node installed through NVM:

```bash
nvm use
corepack enable pnpm
pnpm install
```

Do not install pnpm through `pip`; the similarly named PyPI package is unrelated. pnpm
dependency lifecycle scripts are denied unless the package is explicitly reviewed in the
root `allowBuilds` configuration.

## Quality gates

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
```

Unit tests use Vitest in per-package projects. Browser integration tests use Playwright
and start the demo automatically. CI retains coverage, screenshots, and traces when
relevant.

## Manifest validation

Validate a manifest's structure and timeline semantics without downloading or reading
its referenced media:

```bash
pnpm gs-manifest validate test-data/manifests/minimal-valid.json
```

Add `--check-assets` when the referenced local files or remote URLs are expected to be
available:

```bash
pnpm gs-manifest validate content/lesson.json --check-assets
```

## Dynamic RAD quality-cut generation

Dynamic playback is moving to independent flat SPZ tiers so network/deadline policy can
choose frame quality without running Spark's camera-driven RAD tree at runtime. Generate
the default 10%, 25%, 50%, and 100% leaf-frontier tiers with:

```bash
pnpm gs-content extract-rad-cuts \
  ../sparkjs/data-ply/dynamic/rafa-pitch/frame0040-lod.rad \
  ../sparkjs/data-ply/dynamic/rafa-pitch/frame0041-lod.rad \
  --output-dir ../sparkjs/data-ply/dynamic/rafa-pitch-cuts
```

Shell expansion is convenient for a complete local sequence:

```bash
pnpm gs-content extract-rad-cuts \
  ../sparkjs/data-ply/dynamic/rafa-pitch/frame*-lod.rad \
  --output-dir ../sparkjs/data-ply/dynamic/rafa-pitch-cuts
```

The first run compiles a small Rust helper and downloads the pinned Spark 2.1 source.
Each RAD is then decoded independently, so processing a long sequence does not retain
every frame in memory. Generated files are:

- one flat SPZ per frame and tier, such as `frame0040-minimum.spz`;
- `quality-cuts.json`, containing manifest-compatible `qualityLevels` entries.

The default tiers are `preview=0.10,minimum=0.25,medium=0.50,full=1.00`; `minimum` is
marked playable. Override them when visual calibration supports different cuts:

```bash
pnpm gs-content extract-rad-cuts frame0040-lod.rad \
  --output-dir generated/rafa-pitch \
  --tiers base=0.15,standard=0.35,full=1 \
  --minimum-playable standard \
  --max-sh 1
```

Existing outputs are protected unless `--force` is supplied. Tier ratios are relative to
the RAD tree's leaf count. The exporter expands the largest current representative
first, clears all child metadata, and applies Spark's footprint-preserving LoD-opacity
conversion before SPZ encoding. The resulting files therefore load through
`PackedSplats` as ordinary non-LoD assets.

Expose the generated directory to the local demo:

```bash
ln -s /media/data/code/sparkjs/data-ply/dynamic/rafa-pitch-cuts \
  apps/demo/public/assets/local-dynamic-cuts
```

Then select its quality index when starting the demo:

```bash
VITE_DYNAMIC_QUALITY_INDEX_URL=/assets/local-dynamic-cuts/quality-cuts.json \
VITE_DYNAMIC_RAD_START_FRAME=40 \
VITE_DYNAMIC_RAD_END_FRAME=50 \
VITE_DYNAMIC_RAD_FRAME_RATE=30 \
pnpm dev
```

`VITE_DYNAMIC_RAD_BASE_URL` is optional in this mode. When both variables are present,
RAD remains the fallback frame URL while the buffer transfers the selected flat SPZ
tier. The policy chooses the smallest tier meeting its target and never selects a tier
below the index's `minimumPlayable` entry.

Flat frames are hidden after their initial upload fence and made visible only for
presentation. This is important: transparent-but-visible future frames still participate
in Spark's generation and sorting pass.

The demo's `Dynamic transfer` panel selects an explicit SPZ tier when automatic quality
is disabled. Its status displays both the selected tier and the currently presented
tier. After changing tiers, step or play to hand off to the newly buffered
representation; the old current frame deliberately remains visible until then. The
separate `Dynamic render weight` control affects Spark rendering policy, not which SPZ
file is transferred.

To isolate playback/rendering cost from ongoing network activity, opt into full-sequence
preloading:

```bash
VITE_DYNAMIC_PRELOAD_ALL_FRAMES=true \
VITE_DYNAMIC_QUALITY_INDEX_URL=/assets/local-dynamic-cuts/quality-cuts.json \
VITE_DYNAMIC_RAD_START_FRAME=1 \
VITE_DYNAMIC_RAD_END_FRAME=100 \
VITE_DYNAMIC_RAD_FRAME_RATE=30 \
pnpm dev
```

This replaces the normal five-frame window with a circular window covering the complete
configured sequence. Playback controls remain disabled until every frame has completed
base preparation. Selecting another SPZ tier repeats that complete preload and disables
playback again until the replacement tier is resident. This is a diagnostic mode rather
than the intended streaming architecture and can consume hundreds of megabytes of CPU
and GPU memory, especially at medium or full quality.

The measured-performance panel separates presentation cadence and dropped playback
deadlines from renderer work. `Render call` covers the synchronous Three.js render
submission, `Spark update` covers Spark's generator/update cycle, and `Spark sort`
measures actual sort jobs started by that cycle. These samples are emitted in batches
approximately every 500 ms so measurement does not add a React update or console entry
to every displayed frame.

Use a hardware-accelerated browser for frame-rate measurements. Playwright's headless
Chromium can fall back to software WebGL; on the current development machine it reports
0 fps even for one approximately 70k-splat minimum tier, so its real-asset run validates
loading/lifecycle diagnostics but is not a meaningful 30 fps performance result.

## Renderer development

The demo initialises the real Spark renderer and loads the self-contained
`apps/demo/public/assets/marker.gltf` fixture. Renderer unit tests use injected runtime
factories so lifecycle and failure cases do not require WebGL or `.RAD` assets.

Real `.RAD` decoding, paging, transforms, and visual alignment must be smoke-tested when
representative content becomes available. Record the asset provenance and whether it may
be committed before adding it to automated tests.

To exercise a developer-provided static `.RAD` file without committing it, place it in
`test-data` and expose it to Vite through the ignored local fixture link:

```bash
ln -s ../../../../test-data/point_cloud_29999_clean-lod.rad \
  apps/demo/public/assets/local-static.rad
```

Then start the demo with:

```bash
VITE_STATIC_RAD_URL=/assets/local-static.rad pnpm dev
```

The viewport reports `Static RAD ready` only after Spark has fetched and initialised the
asset. The same environment variable enables the optional `.RAD` assertion in the
Playwright smoke test. The demo applies a 180-degree rotation around the X axis to the
local `.RAD` object, converting the Y-down/Z-forward capture convention used by the
current fixtures to Three.js's Y-up/Z-back convention. Production manifests should set
the equivalent object transform when their source content uses this convention:

```json
{
  "transform": {
    "rotation": { "w": 0, "x": 1, "y": 0, "z": 0 }
  }
}
```

The demo viewport uses Three.js `OrbitControls`: primary-button drag orbits,
secondary-button drag pans, and the wheel zooms. Touch gestures are enabled by the
control implementation.

The `Object scale` panel provides separate uniform controls for `Static scene scale` and
`Dynamic actor scale`. Use these to calibrate independently captured assets without
changing their axis conversion. Scaling is applied around each object's local origin, so
an asset whose origin is not on the intended floor may also require a translation in its
content transform. The current capture-to-world 180-degree X rotation is preserved when
either scale changes.

To exercise a local dynamic range, expose a directory containing files named
`frameNNNN-lod.rad` through the ignored preview link:

```bash
ln -s /absolute/path/to/rafa-pitch apps/demo/public/assets/local-dynamic
```

Configure the inclusive source range and start the paged-RAD fallback demo:

```bash
VITE_STATIC_RAD_URL=/assets/local-static.rad \
VITE_DYNAMIC_RAD_BASE_URL=/assets/local-dynamic \
VITE_DYNAMIC_RAD_START_FRAME=40 \
VITE_DYNAMIC_RAD_END_FRAME=50 \
VITE_DYNAMIC_RAD_FRAME_RATE=30 \
pnpm dev
```

The demo maps the source range to zero-based logical frame indices, applies the shared
capture-to-world transform, and exposes Previous, Play/Pause, and Next diagnostic
controls. A configurable player-core ring buffer owns at most five frames by default:
the presented frame, three future frames, and one previous frame. The current frame
appears only after its presentation-quality target is resident and stable while the
remaining window fills in the background. A root page is base readiness and is never
shown as the final handoff quality. If a requested frame misses its absolute 30 fps
deadline, the controls report `Buffering dynamic GS` and the current frame remains
visible. Playback resumes from a new monotonic clock anchor after two future frames are
presentation-ready.

Changing the dynamic actor scale updates every prepared frame in the current temporal
buffer and becomes the transform used for frames prepared later. The update invalidates
the affected Spark presentation-readiness state and restarts quality preparation as
needed; a frame must satisfy the current presentation target again before it can be
handed off. This keeps the scale consistent across buffered and future frames rather
than applying it only to the visible frame.

The deterministic baseline target is 0.25 spatial detail. It is configurable through the
`FrameRingBuffer` API, including an optional selected-splat floor for controlled
experiments. The default floor is two, preventing Spark's single root splat from being
mistaken for an achieved 25% frame. Content-specific experiments should raise the floor
to a measured minimum acceptable representation; the current demo uses 100 splats for
the unoptimised `rafa-pitch` sequence.

The demo limits dynamic base preparation to two frames and refinement to one frame at a
time. `FrameRingBuffer.setPreparationConcurrency` can change both limits at runtime;
queued base requests are reordered by temporal distance, deadline, and estimated bytes.

Enable `Automatic buffer-aware quality` in the render-quality panel to use the
multi-window client throughput estimate, buffer occupancy, and renderer FPS. The policy
reduces quality immediately when buffer risk rises and requires repeated healthy samples
before increasing it. Manual controls remain the deterministic fixed-quality baseline.

### Playback timing trace

The demo's `Playback trace` panel shows the newest 50 buffer events and mirrors the same
structured objects to the browser console under `[playback-trace]`. Use the stage gaps
to locate a slow handoff:

- `base requested` to Spark `resource initialized` covers initial URL/cache access and
  Spark resource creation;
- `metadata ready` to `minimum renderable` covers the paged RAD metadata and root-page
  path. Patched Spark milestones break that interval into `chunk-fetch`, `chunk-decode`,
  `page-allocation`, `gpu-upload`, `tree-registration`, `tree-update`, and
  `tree-traversal`. Each line shows both its position in total preparation time (`at`)
  and its internally measured stage duration;
- `refinement started` to `refinement ready` covers the 25% presentation target. Its
  page counters distinguish outstanding fetches from `GPU queue` uploads; a remaining
  delay with both at zero is Spark's stable-render confirmation;
- `presentation gate passed` to `presented` is the actual visibility handoff and should
  be effectively immediate.

`base ready` is deliberately weaker than `presentation gate passed`. The renderer's
prepared-frame metric counts root-ready Spark slots, so it can rise to five before all
five frames are safe to present. A browser `304` response can likewise represent only a
small cached range validation; the trace's loaded/total byte values come from RAD page
metadata and resident chunks, not the response-header size shown by DevTools.

Library integrations can subscribe without the demo by passing `onTrace` to
`FrameRingBuffer`. The callback is optional, uses the buffer's injected monotonic clock,
and is isolated so diagnostic code cannot interrupt playback.

Dynamic frame preparation calls the patched Spark pager's cancellable `prepareChunk(0)`
API. The request remains ahead of camera-driven refinement until chunk 0 has reached its
GPU page. Spark's page textures are allocated as a shared pool and reused; a
`preallocated free page` trace means a free pool slot was consumed, while
`reused evicted page` means an existing slot was reassigned. `gpu-upload` includes lazy
SH texture creation and is therefore the timer to inspect for first-use allocation
spikes.

The Spark change is committed at `patches/@sparkjsdev__spark@2.1.0.patch` through pnpm's
`patchedDependencies`. Running `pnpm install` applies it automatically. When upgrading
Spark, rebase and remeasure this patch rather than copying the old diff blindly.

The `Measured playback performance` panel reduces trace history into p50/p95 queue,
root-ready, refinement, and handoff durations, together with observed base throughput
and switching rate. Run the opt-in real-asset benchmark with:

```bash
RUN_PLAYBACK_BENCHMARK=1 \
VITE_DYNAMIC_RAD_BASE_URL=/assets/local-dynamic \
pnpm test:e2e:performance
```

The benchmark advances five frames and prints `PLAYBACK_PERFORMANCE_SUMMARY` as JSON.
The 2026-07-15 local Chromium baseline with the unoptimised frames 40–50 measured:

- root-ready p50/p95: 1.45/3.37 seconds;
- refinement p50/p95: 0.48/1.21 seconds;
- presentation wait p50/p95: 22.9/896.2 milliseconds;
- visibility handoff p50/p95: 0.10/0.20 milliseconds;
- selected splats at handoff: approximately 8,300–8,600.

These are pipeline measurements for one development machine, not target-device results.
The reported manual switching rate includes time spent waiting between button presses
and must not be interpreted as the maximum renderer frame rate. The captured baseline is
committed at
[`project/measurements/2026-07-15-local-chromium.json`](project/measurements/2026-07-15-local-chromium.json).

Run the opt-in real-asset browser check with the same environment variables:

```bash
VITE_STATIC_RAD_URL=/assets/local-static.rad \
VITE_DYNAMIC_RAD_BASE_URL=/assets/local-dynamic \
pnpm test:e2e
```

The source start/end default to `40`/`50` and the frame rate defaults to `30`, so only
the two asset URLs are required for that range.

## Package boundaries

- `player-core` must never import Spark or React.
- Concrete rendering is accessed through `GaussianRendererAdapter`.
- Quality policy is accessed through `QualityController`.
- Network telemetry is accessed through `NetworkTelemetryProvider`.
- Shared types must remain usable without browser globals unless their API explicitly
  models a browser facility.
- Every owned async operation should accept cancellation where practical, and every
  owned runtime resource must have an explicit disposal path.

ESLint enforces the most important renderer dependency restriction. Additional boundary
rules should be added as integrations arrive.

## Changing project direction

Update `docs/project/TODO.md` when priorities or task state change. Record durable
architecture decisions in an ADR and add it to `docs/project/DECISIONS.md`. Add
meaningful completed slices to `CHANGELOG.md`.
