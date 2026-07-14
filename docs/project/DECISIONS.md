# Project Decisions

Architecture decisions are recorded as ADRs in
[`docs/architecture/decisions`](../architecture/decisions). This file is the short index
used during day-to-day implementation.

| ADR  | Decision                                         | Status   |
| ---- | ------------------------------------------------ | -------- |
| 0001 | Use a pnpm workspace monorepo                    | Accepted |
| 0002 | Isolate renderers behind a core adapter          | Accepted |
| 0003 | Use one `.RAD` asset per dynamic frame initially | Accepted |
| 0004 | Inject adaptive quality policy                   | Accepted |
| 0005 | Make the sequence manifest player-owned          | Accepted |
| 0006 | Normalise network telemetry behind a provider    | Accepted |

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
- Dynamic Spark resources are owned by explicit frame slots; presentation changes slot
  visibility, while release or cancellation disposes the slot's mesh without recreating
  the scene.
- Spark-specific LoD and foveation settings remain on the concrete adapter. The core
  quality decision is translated at the boundary so Spark properties do not leak into
  `player-core`.
