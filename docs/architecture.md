# Architecture Overview

The player separates time, policy, rendering, telemetry, and application UI so each can
evolve independently.

```text
Demo application
       |
       v
GaussianSequencePlayer (player-core)
  |          |             |
  v          v             v
Renderer   Quality       Telemetry
adapter    controller    provider
  |
  v
Spark + Three.js
```

`player-core` owns playback time, frame selection, buffering, scheduling, and events. It
describes rendering work through `GaussianRendererAdapter`; the Spark package implements
that boundary without leaking Spark types into core.

Quality controllers receive normalised playback, network, and metric snapshots. They
produce decisions rather than performing requests or renderer mutations. This permits
fixed, client-measured, simulated, and 6G-assisted policies to be tested against the
same engine.

The demo is an integration client, not an owner of playback state. It may use React for
presentation, but all state transitions and scheduling remain in the
framework-independent packages.

## Initial package dependency direction

```text
shared <--- player-core <--- renderer-spark
                    ^ <--- telemetry-6g

player packages <--- demo
```

`content-tools` consumes the versioned manifest schema owned by `player-core`. Its
Node-only validation entry point is kept separate from browser-facing exports.

## Decisions

The accepted foundation decisions are indexed in
[`project/DECISIONS.md`](project/DECISIONS.md) and recorded in full under
[`architecture/decisions`](architecture/decisions).

See the [Spark renderer integration guide](renderer-integration.md) for the concrete
renderer lifecycle and ownership rules.
