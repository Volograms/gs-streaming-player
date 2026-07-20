# Gaussian Streaming Player

Adaptive browser player for composited Gaussian Splat content in the 6G-PATH project.
The player is designed for persistent static splats, per-frame dynamic Gaussian
sequences, conventional Three.js meshes, video-style buffering, and network-aware
progressive quality. Compressed streaming, Gaussian codecs, and renderer adapters are
independent boundaries. Spark remains the mature RAD/flat-SPZ option, while a dedicated
Babylon.js adapter and demo now consume the same official Niantic SPZ v4 decoded frames.

The repository and content-manifest foundations are complete. The active implementation
slice is renderer-neutral codec integration and dynamic playback measurement. See the
[project plan](docs/project-summary.md) and the live
[task tracker](docs/project/TODO.md).

## Requirements

- Node.js 22.12 or newer
- Corepack with pnpm enabled

The pnpm version is pinned in `package.json` and should not be installed through
Python's `pip`.

```bash
corepack enable pnpm
pnpm install
```

## Common commands

```bash
pnpm dev           # Run the Spark reference demo
pnpm dev:babylon   # Run the Babylon.js SPZ/WebXR comparison demo
pnpm build         # Build every library package and the demo
pnpm profile:demo     # Build and serve the production Spark demo
pnpm profile:babylon  # Build and serve the production Babylon.js demo
pnpm typecheck     # Type-check every workspace package
pnpm lint          # Run ESLint across the repository
pnpm format:check  # Check Prettier formatting
pnpm gs-manifest   # Run manifest content tools
pnpm test          # Run all unit tests
pnpm test:e2e      # Run the Chromium smoke tests
```

For browser tests, install Chromium once with:

```bash
pnpm exec playwright install chromium
```

## Workspace

| Path                        | Package                              | Responsibility                                     |
| --------------------------- | ------------------------------------ | -------------------------------------------------- |
| `packages/player-core`      | `@6g-path/gaussian-player`           | Renderer-independent playback contracts and engine |
| `packages/codec-core`       | `@6g-path/gaussian-codec`            | Renderer-neutral decoded-frame and codec contracts |
| `packages/codec-spz`        | `@6g-path/gaussian-codec-spz`        | Official Niantic SPZ v4 browser decoder            |
| `packages/demo-support`     | `@6g-path/gaussian-demo-support`     | Shared renderer-neutral demo content configuration |
| `packages/renderer-spark`   | `@6g-path/gaussian-renderer-spark`   | Spark and Three.js integration                     |
| `packages/renderer-babylon` | `@6g-path/gaussian-renderer-babylon` | Babylon.js integration and native frame packing    |
| `packages/telemetry-6g`     | `@6g-path/gaussian-telemetry-6g`     | Normalised 6G telemetry providers                  |
| `packages/content-tools`    | `@6g-path/gaussian-content-tools`    | Manifest and content preparation tools             |
| `packages/shared`           | `@6g-path/shared`                    | Small environment-neutral shared types             |
| `apps/demo`                 | `@6g-path/demo`                      | Spark integration and diagnostics application      |
| `apps/demo-babylon`         | `@6g-path/demo-babylon`              | Babylon.js SPZ and optional WebXR comparison       |

The player packages do not depend on React. The demo consumes only their public package
APIs.

## Architecture

Start with the [architecture overview](docs/architecture.md). Architectural rules and
their rationale are recorded in
[`docs/architecture/decisions`](docs/architecture/decisions).

Content authors should also read the [manifest format](docs/manifest-format.md), which
documents schema validation, URL resolution, and the validator CLI.

Application developers should read the
[Spark renderer integration guide](docs/renderer-integration.md) for lifecycle,
ownership, loading, cancellation, and transform semantics.

The [Babylon.js integration guide](docs/babylon-renderer-integration.md) documents the
current neutral-SPZ capability, persistent-mesh handoff, dedicated demo, and WebXR
entry.
