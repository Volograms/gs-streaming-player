# ADR 0006: Normalise network telemetry behind a provider

- Status: Accepted
- Date: 2026-07-14

## Context

The 6G testbed transport and vendor fields are not yet fixed, while generic adaptation
and simulations must be implemented first.

## Decision

Expose telemetry through `NetworkTelemetryProvider` and the normalised `NetworkState`
model. Testbed clients live in `telemetry-6g`; `player-core` does not know WebSocket,
polling, vendor, authentication, or raw field details.

## Consequences

Mock and client-measured sources can be used before the testbed exists. Stale telemetry
and fallback can be handled consistently. Testbed-specific signals must be mapped and
assigned confidence before reaching quality policy.
