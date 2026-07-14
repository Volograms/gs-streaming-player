# ADR 0002: Isolate renderers behind a core adapter

- Status: Accepted
- Date: 2026-07-14

## Context

Spark is the first renderer, but playback time, buffering, scheduling, and quality
policy do not inherently depend on it.

## Decision

`player-core` defines `GaussianRendererAdapter`. Concrete packages implement the
interface and own renderer-specific resources. Core cannot import Spark, Three.js, or a
concrete renderer package.

## Consequences

Core logic can run in deterministic unit tests without WebGL. Spark-specific
capabilities remain available through its adapter. The boundary may need careful
extension as progressive `.RAD` loading is validated, but concrete Spark types must not
cross it.
