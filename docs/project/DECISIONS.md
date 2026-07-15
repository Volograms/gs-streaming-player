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
