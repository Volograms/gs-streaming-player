# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in
this repository.

@AGENTS.md

The imported `AGENTS.md` holds the repository rules (toolchain, package boundaries,
project management, code quality, validation). Its "Purpose" section predates the
current product direction; where it conflicts with the notes below, the notes below and
`README.md` win.

## What this is

A pnpm monorepo for a browser player of 4D Gaussian Splat (4DGS) sequences plus static
splats, optional meshes, audio, adaptive quality, and WebXR. The recommended delivery
path is **PlayCanvas + SOG v2** (WebGPU with GPU sort, one-time WebGL2 fallback).
Spark/RAD and Babylon/SPZ are experimental laboratories kept for measurement — do not
treat them as the product path.

## Commands

Requires Node ≥ 22.13 and Corepack (`corepack enable pnpm`); never install pnpm via pip.
Run from the repo root.

```bash
pnpm install --frozen-lockfile   # also applies patches/ (Spark, Babylon) via patchedDependencies
pnpm dev:showcase                # public player, http://localhost:4180/#/
pnpm dev:showcase:https          # needed for WebXR / Quest (see docs/quest-webxr.md for the cert)
pnpm dev:playcanvas | dev:babylon | dev   # diagnostic labs (dev = Spark/RAD demo)
pnpm profile:showcase            # production build + preview; use for perf captures, not the dev server

pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
pnpm test:e2e                    # Playwright; scripts/run-e2e.mjs starts demo (:4173) + showcase (:4180)
```

Running a subset of tests:

```bash
pnpm vitest run --project player-core                         # one package (project name = vitest `name`)
pnpm vitest run packages/player-core/tests/FrameRingBuffer.test.ts # one file
pnpm vitest run -t "partial test name"                         # by name
pnpm test:e2e tests/e2e/showcase.smoke.spec.ts                 # one e2e spec (args forwarded to playwright)
```

Lint runs with `--max-warnings 0`. ESLint enforces `import-x/order` (alphabetized
groups, blank line between groups, type imports last with top-level `import type`) —
follow it or lint fails.

Content CLI (runs from source through `tsx`):

```bash
pnpm gs-manifest validate path/to/manifest.json [--check-assets]
pnpm gs-content build dataset.json --output-dir dist/content [--dry-run]
pnpm gs-content generate-tiers frame*.ply --output-dir out --format sog|spz
```

## Architecture

Package names are `@6g-path/*`, not the directory names (e.g. `packages/player-core` →
`@6g-path/gaussian-player`). Tests and Vite resolve workspace packages to their `src/`
through the aliases in `vitest.shared.config.ts`; add a new package there as well as to
the consuming `package.json`.

Dependency direction (no cycles; lower layers never import higher ones):

```text
shared ← codec-core ← codec-spz
              ↑
         player-core ← renderer-{playcanvas,babylon,spark}, telemetry-6g, content-tools, demo-support
                   ← apps/*
```

`cue-timeline` has no workspace dependencies. It is the explainer's time-driven cue
evaluation, consumed by `apps/6g-showcase`.

- **`player-core`** owns time and policy, not pixels or payload formats. The public
  facade `player/GaussianStreamingPlayer.ts` owns the whole lifecycle: manifest
  load/validation (`manifest/`, TypeBox + Ajv schema, compact↔expanded forms), sequence
  selection, the byte-budgeted `CompressedFrameCache` (network stage, runs ahead of
  playback), the `FrameRingBuffer`/`FramePreparationScheduler` (decode/prepare window
  around the playhead), `MediaPlaybackClock`/`SequencePlaybackController` (audio-synced
  timing), and `quality/BufferAwareQualityController` fed by
  `network/ClientThroughputEstimator`. Quality controllers return decisions; they never
  fetch or touch the renderer.
- **Renderers** implement `GaussianRendererAdapter`
  (`player-core/src/renderer/types.ts`). An adapter declares which codecs it accepts.
  Codec choice is explicit content metadata; there is **no silent codec or renderer
  fallback** at runtime. PlayCanvas ingests SOG bundles natively (bytes go straight from
  the cache to the adapter); Spark and Babylon receive renderer-neutral attribute arrays
  decoded by `codec-spz` workers and pack them in their own worker pools. Decoded typed
  arrays are transferred, so treat them as consumed once handed to renderer preparation.
- **`content-tools`** is Node-only authoring (SplatTransform merge-decimation into
  SOG/SPZ tiers, Streamed SOG for large statics, manifest generation/validation). It
  consumes the manifest schema owned by `player-core`; keep its Node entry
  (`src/node.ts`) separate from browser-facing exports. The Rust RAD extractor
  (`rust/rad-quality-cuts`) is legacy.
- **Apps** are integration clients. `apps/showcase` is the public product (only uses
  player-core + renderer-playcanvas). `apps/6g-showcase` (`@6g-path/6g-showcase`, port
  4182, `pnpm dev:6g-showcase[:https]`) began as a copy of the showcase for a 6G demo
  and is expected to diverge from it. `apps/demo*` are diagnostic labs configured
  largely through `VITE_*` env vars (see `docs/development.md`, `.env.example` files).
  Reusable logic belongs in packages, not apps.

Key design records: `docs/architecture.md`, ADRs in `docs/architecture/decisions/`
(indexed in `docs/project/DECISIONS.md`), manifest contract in
`docs/manifest-format.md`, coordinate conventions in `docs/coordinate-system.md`.

## Gotchas

- `packages/codec-spz/src/vendor/` is vendored upstream Niantic SPZ (pinned in
  `UPSTREAM.md`) and excluded from lint — don't hand-edit.
- Spark and Babylon are patched (`patches/`). When upgrading either, rebase and
  re-measure the patch rather than copying the old diff.
- Datasets, traces, certificates, and private URLs must not be committed. Local datasets
  are served via `SHOWCASE_LOCAL_DATASET_DIR` in `apps/showcase/.env.local` or ignored
  `public/assets/` links.
- Headless Playwright Chromium may use software WebGL; its frame rates are not
  meaningful performance data. Record real measurements (with hardware/browser/content
  conditions) in `docs/project/PERFORMANCE.md`.
