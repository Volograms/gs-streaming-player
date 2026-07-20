# Architecture Overview

The player separates time, policy, rendering, telemetry, and application UI so each can
evolve independently.

```text
Demo application
       |
       v
GaussianSequencePlayer (player-core)
  |          |             |          |
  v          v             v          v
Byte cache  Codec       Renderer    Quality / telemetry
            decoder     adapter     policies
                         |
                         v
                    Spark + Three.js
                    Babylon.js
                    PlayCanvas
```

`player-core` owns playback time, frame selection, buffering, scheduling, and events. It
owns the compressed-byte reservoir but does not interpret encoded Gaussian payloads.
Codec packages decode those bytes into renderer-neutral Gaussian attribute arrays.
`player-core` then describes rendering work through `GaussianRendererAdapter`; the Spark
package packs the neutral attributes into `PackedSplats` without leaking Spark types
into core.

Codec identity is explicit content metadata. The first external codec is official
Niantic SPZ v4. The old Spark-owned SPZ v3 loader remains a deliberately separate
compatibility path for A/B measurements and can be removed without changing the byte
cache, scheduler, playback clock, or renderer interface. Spark remains a supported
adapter while Babylon.js and PlayCanvas validate the same decoded frames through
different renderer-native representations. SOG v2 is added independently of those
renderer choices.

Quality controllers receive normalised playback, network, and metric snapshots. They
produce decisions rather than performing requests or renderer mutations. The pilot uses
client-measured transfer and buffer signals because its Wi-Fi last hop provides no
actionable 6G telemetry; the provider boundary remains available for a future testbed
that exposes end-to-end client telemetry.

The demo is an integration client, not an owner of playback state. It may use React for
presentation, but all state transitions and scheduling remain in the
framework-independent packages.

## Initial package dependency direction

```text
shared <--- codec-core <--- codec-spz
                  ^
                  +--- player-core <--- renderer-spark
                                  ^ <--- renderer-babylon
                                  ^ <--- renderer-playcanvas (planned)
                                  ^ <--- telemetry-6g (extension point)

player packages <--- renderer-specific demos
```

`content-tools` consumes the versioned manifest schema owned by `player-core`. Its
Node-only validation entry point is kept separate from browser-facing exports.

## Decisions

The accepted foundation decisions are indexed in
[`project/DECISIONS.md`](project/DECISIONS.md) and recorded in full under
[`architecture/decisions`](architecture/decisions).

See the [Spark renderer integration guide](renderer-integration.md) for the concrete
renderer lifecycle and ownership rules.
