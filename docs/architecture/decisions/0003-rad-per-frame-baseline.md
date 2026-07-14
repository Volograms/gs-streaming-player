# ADR 0003: Use one `.RAD` asset per dynamic frame initially

- Status: Accepted
- Date: 2026-07-14

## Context

The project needs a measurable dynamic Gaussian baseline before introducing a new
sequence container or temporal compression scheme.

## Decision

Represent the initial dynamic sequence as independently addressable `.RAD` assets
described by a manifest. Treat each frame's base quality and refinements as distinct
scheduling concerns.

## Consequences

The baseline works with ordinary HTTP infrastructure and allows direct measurement of
switching and transfer costs. Metadata and request overhead may be high. Evidence from
this implementation will determine whether a multi-frame container or temporal
compression is justified later.
