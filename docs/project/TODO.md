# Project TODO

This file tracks implementation against the epics in
[`project-summary.md`](../project-summary.md). A task is checked only after its
acceptance criteria are covered by implementation and verification.

## Active implementation slice: Spark asset validation and dynamic scene foundation

- [ ] E02-T03 — Validate static `.RAD` loading with representative project content.
- [ ] E02-T05 — Implement `SparkFrameSlot` dynamic frame representation.
- [ ] E02-T06 — Integrate manual dynamic frame switching with frame slots.
- [ ] E02-T07 — Expose the full Spark LoD and foveation controls.
- [ ] E02-T08 — Complete renderer and resource metrics.

## Completed

### M1 asset-independent renderer foundation (2026-07-14)

- [x] E02-T01 — Finalise the renderer adapter API against Spark requirements.
- [x] E02-T02 — Implement Spark renderer initialisation.
- [x] E02-T04 — Load conventional GLTF/GLB meshes.

The E02-T03 loader implementation, progress reporting, transforms, visibility, failure
isolation, cancellation, and disposal are unit covered. Completion awaits a real `.RAD`
browser and visual-alignment test.

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

- [ ] Obtain representative static `.RAD` content.
- [ ] Obtain at least ten dynamic `.RAD` frames.
- [ ] Obtain a representative production GLB mesh (a minimal glTF test marker is
      committed).
- [ ] Record asset licensing and whether fixtures may be committed.
- [ ] Record known coordinate-system and alignment information.
