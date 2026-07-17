# ADR 0009: Export flat dynamic quality tiers from RAD LoD trees

- Status: Accepted
- Date: 2026-07-16

## Context

Spark's paged RAD path is effective for large static scenes because it chooses a
camera-dependent frontier from an LoD tree. Dynamic playback has a different primary
constraint: the network and frame deadline must choose a complete, presentable frame
before handoff. Recreating, registering, updating, and traversing a separate tree for
every buffered frame adds work that does not contribute to that decision.

The existing RAD files remain useful authoring inputs. Their parent/child hierarchy
already contains merged representatives from which non-overlapping quality frontiers can
be selected.

## Decision

Keep quality-LoD RAD as the initial source format, but add an offline content step for
dynamic sequences:

1. decode each RAD tree with the Spark 2.1 Rust library;
2. create ordered camera-independent frontiers by expanding the largest current
   representative until each configured leaf-count ratio is reached;
3. remove all child metadata and convert LoD opacity into an equivalent flat
   scale/opacity representation;
4. encode each frontier as an independent SPZ asset;
5. record its URL, byte size, splat count, tier ratio, and minimum-playable status in
   quality metadata compatible with the player manifest.

Dynamic playback will load the selected SPZ tier through Spark `PackedSplats` with LoD
disabled. Static RAD objects continue using Spark's paged, camera-aware LoD path. The
quality controller selects a dynamic transfer tier from bandwidth, deadline, and buffer
state; the renderer's device splat budget remains a separate decision.

The extraction tool pins Spark commit `f22236f95fdd8078f0c12e3aab479523d401daf6` (Spark
2.1.0) so RAD decoding and opacity semantics are reproducible.

## Consequences

Buffered dynamic frames no longer need runtime RAD tree registration or traversal once
the flat runtime path is integrated. Each tier is independently cacheable and can be
prefetched like a conventional representation. Decoded future frames remain CPU-side;
one grow-only `PackedSplats` display allocation is overwritten at handoff. Ordering is
not reused between independently encoded frames, so each handoff still requests a fresh
Spark sort.

Separate files duplicate data between tiers and do not provide temporal compression.
That is accepted for the measurable first version. A later sequence container may pack
the same tier payloads together and add inter-frame compression without changing the
player's quality-selection model.

The offline cut ratio is a content budget, not a guarantee of perceptual quality.
Representative sequences still require visual calibration of the minimum-playable tier.
