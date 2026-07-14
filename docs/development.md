# Development Guide

## Toolchain

The workspace requires Node.js 22.12 or newer and uses the exact pnpm release in the
root `packageManager` field. With Node installed through NVM:

```bash
nvm use
corepack enable pnpm
pnpm install
```

Do not install pnpm through `pip`; the similarly named PyPI package is unrelated. pnpm
dependency lifecycle scripts are denied unless the package is explicitly reviewed in the
root `allowBuilds` configuration.

## Quality gates

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
```

Unit tests use Vitest in per-package projects. Browser integration tests use Playwright
and start the demo automatically. CI retains coverage, screenshots, and traces when
relevant.

## Package boundaries

- `player-core` must never import Spark or React.
- Concrete rendering is accessed through `GaussianRendererAdapter`.
- Quality policy is accessed through `QualityController`.
- Network telemetry is accessed through `NetworkTelemetryProvider`.
- Shared types must remain usable without browser globals unless their API explicitly
  models a browser facility.
- Every owned async operation should accept cancellation where practical, and every
  owned runtime resource must have an explicit disposal path.

ESLint enforces the most important renderer dependency restriction. Additional boundary
rules should be added as integrations arrive.

## Changing project direction

Update `docs/project/TODO.md` when priorities or task state change. Record durable
architecture decisions in an ADR and add it to `docs/project/DECISIONS.md`. Add
meaningful completed slices to `CHANGELOG.md`.
