# Repository guidance

## Purpose

Develop a reusable web player library for playback of composited Gaussian Splat content consisting of:

- one or more persistent static Gaussian Splat objects;
- one dynamic Gaussian Splat sequence, initially represented as one `.RAD` file per frame;
- optional conventional Three.js meshes;
- local rendering on mobile, tablet, and desktop devices;
- temporal buffering similar to a conventional video player;
- progressive per-frame spatial level of detail;
- adaptive quality driven first by generic network measurements and later by network telemetry supplied by the 6G testbed.

A separate demo application will integrate the library and provide:

- content loading;
- playback controls;
- scene navigation;
- quality controls;
- network simulation;
- diagnostic visualisation;
- 6G telemetry integration;
- experiment logging.

## Toolchain

- Use Node.js 22.12 or newer.
- Use Corepack and the pnpm version pinned in `package.json`. Do not install pnpm through Python or pip.
- Run commands from the repository root unless a package-specific command is more appropriate.

## Repository layout

- `packages/player-core`: renderer-independent playback, scheduling, buffering, and manifest contracts.
- `packages/codec-*`: Gaussian Splat decoding and codec integrations.
- `packages/renderer-*`: renderer-specific adapters. Keep renderer dependencies out of player-core.
- `packages/content-tools`: manifest and content-processing CLI code.
- `packages/telemetry-6g`: optional 6G telemetry integration.
- `packages/shared`: genuinely cross-package utilities and types.
- `apps/demo` and `apps/demo-babylon`: integration and demonstration applications, not homes for reusable core logic.
- `tests/e2e`: Playwright browser and performance tests.
- `test-data`: small committed fixtures; large local renderer assets are intentionally ignored.
- `docs`: architecture, development, integration, and project records.

## Project management

- Consult `docs/project/TODO.md` when selecting or completing planned work.
- Update `TODO.md` only when task status, priority, or scope materially changes.
- Record an entry in `docs/project/DECISIONS.md` only for an agreed architectural or product decision.
- Update `CHANGELOG.md` for meaningful user-visible or developer-visible changes, not incidental maintenance.
- Document user-facing or administrator-facing configuration in `docs`.

## Code quality rules

- Prefer small focused modules over large multi-purpose files.
- Keep functions and files focused on one domain and responsibility.
- Do not duplicate domain logic across packages. Put shared behavior at the lowest appropriate dependency layer.
- Preserve package boundaries and avoid circular dependencies.
- Keep core playback behavior renderer-independent and testable without WebGL or WebXR where practical.
- Treat cancellation, cleanup, bounded memory use, browser lifecycle changes, and deterministic timing as correctness concerns.
- Do not edit generated output, dependency directories, or large local test fixtures unless the task explicitly requires it.

## Validation

Run the narrowest relevant checks first. Expand validation in proportion to the scope and risk of the change.

- `pnpm typecheck`: type-check workspace packages.
- `pnpm lint`: run ESLint across the repository.
- `pnpm format:check`: verify formatting.
- `pnpm test`: run unit tests.
- `pnpm build`: build all packages and applications.
- `pnpm test:e2e`: run Playwright browser tests when browser or integration behavior is affected.

Report the commands run and any checks that could not be completed. Do not claim validation that was not performed.

## If unsure

Ask for direction before making a choice that would materially change architecture, public APIs, persisted data formats, security, project scope, or an agreed decision. For local implementation details, inspect existing patterns and proceed with the smallest consistent change.
