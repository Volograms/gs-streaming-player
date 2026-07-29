# ADR 0013: Use client-measured network state for the pilot

- Status: Accepted
- Date: 2026-07-20

## Context

The pilot traffic crosses a 6G testbed, but no 6G client device is available. The final
hop to the browser device is simulated over Wi-Fi and does not expose useful 6G radio or
modem telemetry to the player. A policy driven by unavailable 6G-specific measurements
could not be validated end to end.

The target pilot path is expected to peak below approximately 500 Mbps. At the current
SPZ v4 density, full-quality 30 fps frames require more than that link can deliver, so
the player must continue to select transfer quality from measured application-level
delivery and buffer state.

## Decision

The pilot adaptation policy uses ordinary client-observable signals: completed transfer
bytes and duration, request latency where available, compressed-buffer occupancy,
presentation stalls, and measured renderer capacity. It applies a safety margin and
hysteresis and selects independently addressable frame quality tiers.

The normalised network-provider boundary and the `telemetry-6g` package remain valid
extension points, but testbed-specific policy work is deferred until actionable
end-to-end telemetry is available. The final roadmap epic is re-scoped from mandatory
6G-assisted adaptation to pilot validation of client-measured adaptation over the
testbed/Wi-Fi path.

## Consequences

The pilot remains representative of the bandwidth variation visible to a web client, but
it cannot claim gains from 6G-specific scheduling, radio state, slicing, or modem
telemetry. Experiment reports must describe the Wi-Fi last hop and must not label
client-estimated throughput as 6G telemetry.

Future 6G providers can be added without changing playback or renderer adapters because
quality policy consumes the existing normalised `NetworkState` contract.
