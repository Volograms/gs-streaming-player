# ADR 0015: Public-preview product surface

- Status: Accepted
- Date: 2026-07-29

## Decision

Present the repository as the source-only **Volograms 4DGS Streaming Player** public
preview. `GaussianStreamingPlayer` and the canonical manifest are the integration
surface. Recommend PlayCanvas/SOG with WebGPU GPU sorting and WebGL2 fallback. Retain
Spark/RAD and Babylon/SPZ as experimental diagnostics. Preserve `@6g-path/*` package and
schema identities until publication is considered.

The public showcase contains a landing route and a clean Quest-oriented player. Data is
external and selectable by URL. One dynamic sequence, optional static splats/meshes, and
one audio track are supported; simultaneous dynamic sequences and playback-rate control
are deferred.

## Consequences

Workspace packages stay private. GitHub Pages builds from source and remains useful
without a configured sample. SOG is the recommended delivery format; ordered PLY or SPZ
frames are the public dynamic authoring inputs. RAD authoring is legacy, and support
claims are tiered. Experimental tuning stays out of the showcase. Performance records
state conditions and limitations rather than guarantees.
