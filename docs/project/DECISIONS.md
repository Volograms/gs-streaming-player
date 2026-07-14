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
