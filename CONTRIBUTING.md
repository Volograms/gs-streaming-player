# Contributing

Thank you for helping improve the Volograms 4DGS Streaming Player public preview.

Open an issue before changing a public API, manifest schema, package boundary, or
supported product claim. Keep renderer dependencies out of player-core and reusable
logic out of demo apps. Large datasets, traces, private URLs, and certificates must not
be committed.

Use Node.js 22.12+ and the pinned Corepack/pnpm version. Before a pull request, run:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
```

Document user-visible behavior, add focused tests, update the changelog for meaningful
changes, and include hardware/browser/content/build conditions for performance data. By
participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
