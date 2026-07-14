# ADR 0004: Inject adaptive quality policy

- Status: Accepted
- Date: 2026-07-14

## Context

Fixed quality, client throughput adaptation, simulation, and 6G-assisted policy must be
comparable without changing the playback engine.

## Decision

The engine depends on the `QualityController` interface. Controllers consume read-only
playback, network, and metrics snapshots and return a `QualityDecision`. They do not
directly fetch content or mutate the renderer.

## Consequences

Policies are deterministic and independently testable. Transfer quality and render
quality can be controlled separately. New inputs require deliberate evolution of
normalised domain types rather than vendor-specific fields.
