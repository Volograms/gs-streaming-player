# Project TODO

This file tracks implementation against the epics in
[`project-summary.md`](../project-summary.md). A task is checked only after its
acceptance criteria are covered by implementation and verification.

## Active implementation slice: Static and dynamic scene composition

- [ ] E03-T01 — Complete visual alignment validation for the composed static GS, dynamic
      GS, and mesh scene. The real assets now load and switch together.
- [ ] E03-T04 — Validate dynamic alpha and background masking behaviour.
- [ ] E03-T05 — Measure dynamic switching performance.

## Completed

### E03 coordinate and alignment foundation (2026-07-15)

- [x] E03-T02 — Define and document the player coordinate-system conventions.
- [x] E03-T03 — Apply translation, quaternion rotation, scale, and matrix alignment to
      static splats, meshes, and every dynamic frame.

The demo composes the persistent mesh and optional static RAD with an opt-in local
dynamic range. Chromium decoded frames 40-50 of `rafa-pitch`, retained all 11 prepared
slots, and switched forward and backward without recreating the scene. Final E03-T01
completion awaits visual confirmation of scale and origin alignment.

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
