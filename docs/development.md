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

To exercise a local dynamic range, expose a directory containing files named
`frameNNNN-lod.rad` through the ignored preview link:

```bash
ln -s /absolute/path/to/rafa-pitch apps/demo/public/assets/local-dynamic
```

Configure the inclusive source range and start the demo:

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
deadline, the controls report `Buffering dynamic RAD` and the current frame remains
visible. Playback resumes from a new monotonic clock anchor after two future frames are
presentation-ready.

The deterministic baseline target is 0.25 spatial detail. It is configurable through the
`FrameRingBuffer` API, including an optional selected-splat floor for controlled
experiments. The floor defaults to zero because a valid count depends on camera view and
the global render budget. This gate guarantees stable handoff, but sustained 30 fps
still requires enough network/decode/upload throughput for that target. Generic
throughput-driven target selection is the next adaptive-quality slice.

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
