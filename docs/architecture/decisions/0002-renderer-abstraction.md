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

The neutral contract returns object handles, reports byte progress, accepts
cancellation, and exposes transform, visibility, release, quality, and metric
operations. Concrete scene nodes remain private to the renderer.

`SparkGaussianRendererAdapter` may create its complete Three.js environment from a
canvas or attach to caller-owned scenes, cameras, and renderers. It never disposes a
caller-owned resource. Loaded splats and meshes are staged off-scene until successful
initialisation, then owned by the adapter until explicitly released or disposed.

## Consequences

Core logic can run in deterministic unit tests without WebGL. Spark-specific
capabilities remain available through its adapter. Runtime factories allow the concrete
adapter's lifecycle to be tested without a GPU, while the demo smoke test covers actual
Spark WebGL initialisation. The boundary may need careful extension as progressive
`.RAD` loading is validated, but concrete Spark types must not cross it.
