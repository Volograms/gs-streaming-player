# Project TODO

This file tracks implementation against the epics in
[`project-summary.md`](../project-summary.md). A task is checked only after its
acceptance criteria are covered by implementation and verification.

## Active implementation slice: Content manifest foundation

- [ ] E01-T01 — Define the versioned sequence manifest schema.
- [ ] E01-T02 — Implement the manifest loader.
- [ ] E01-T03 — Implement the manifest validator CLI.

## Next milestone: M1 — L1 Static Scene

- [ ] E02-T01 — Finalise the renderer adapter API against Spark requirements.
- [ ] E02-T02 — Implement Spark renderer initialisation.
- [ ] E02-T03 — Load static `.RAD` objects.
- [ ] E02-T04 — Load conventional GLTF/GLB meshes.

## Completed

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
- [ ] Obtain a representative GLB mesh.
- [ ] Record asset licensing and whether fixtures may be committed.
- [ ] Record known coordinate-system and alignment information.
