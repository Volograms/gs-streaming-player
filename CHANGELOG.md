# Changelog

All notable changes to this project will be documented here. The project uses
[Semantic Versioning](https://semver.org/) once packages enter public release.

## [Unreleased]

### Added

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
