# Changelog

All notable changes to this project will be documented here. The project uses
[Semantic Versioning](https://semver.org/) once packages enter public release.

## [Unreleased]

### Added

- Initial product and implementation plan.
- Milestone M0 pnpm workspace with independently buildable player, Spark renderer,
  telemetry, content-tool, shared, and demo packages.
- Strict TypeScript domain contracts for manifests, playback, quality, network state,
  and the renderer abstraction.
- React/Vite reference demo consuming all library packages through workspace APIs.
- ESLint, Prettier, Vitest coverage, Playwright smoke tests, and GitHub Actions quality
  gates.
- Architecture overview and six initial architecture decision records.
- Project TODO and decision tracking workflow.
