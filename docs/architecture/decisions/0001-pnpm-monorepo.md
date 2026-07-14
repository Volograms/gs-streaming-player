# ADR 0001: Use a pnpm workspace monorepo

- Status: Accepted
- Date: 2026-07-14

## Context

The player consists of independently buildable libraries, tooling, examples, and a demo
that share types and must be tested together.

## Decision

Use a pnpm workspace with packages under `packages`, applications under `apps`, and
examples under `examples`. Pin pnpm in the root `packageManager` field and run common
quality gates from the root.

## Consequences

Workspace dependencies are linked locally and released packages can remain independent.
Changes spanning package boundaries are validated atomically. CI and contributors must
use the pinned pnpm and supported Node.js version.
