# ADR 0016: Generate public dynamic tiers from PLY or SPZ

- Status: Accepted
- Date: 2026-07-29

## Context

ADR 0009 proved that complete flat quality tiers are a better temporal runtime contract
than traversing one RAD tree per frame. Its extractor, however, depends on Spark's Rust
RAD implementation and project-specific frontier logic. That is unnecessary weight for a
public source workflow when common reconstruction tools already emit PLY or SPZ and
SplatTransform provides public merge-based decimation.

Streamed SOG also contains a hierarchy, but it solves spatial selection for a persistent
scene. A temporal frame still needs a bounded, complete representation selected by the
player's network and buffer policy.

## Decision

The normal content build accepts ordered dynamic PLY or SPZ frames. For every configured
ratio, the pinned public SplatTransform dependency performs merge-based decimation and
encodes an independently addressable bundled SOG or SPZ v4 file. SOG is the default and
recommended web-delivery format; SPZ v4 remains available for renderer and CPU-decode
experiments. Generated metadata records actual output splat counts and byte sizes.

Build recipes normally identify a directory rather than enumerate frames. The build
discovers top-level PLY/SPZ files in deterministic natural filename order and writes the
expanded file list only into the generated canonical manifest. An explicit frame array
remains available for irregular ordering; the two input forms are mutually exclusive.

Tier generation uses bounded frame-level parallelism while preserving input order in
metadata. Tiers within a frame remain sequential because parallel decimation and SOG
compression can multiply memory, scratch-disk, and GPU pressure. Frame concurrency and
per-SOG-encoder worker counts are independently configurable.

Persistent static sources continue to export as Streamed SOG. The existing
`extract-rad-cuts` command, Rust helper, and RAD-to-SOG conversion commands remain
available for legacy datasets, but `gs-content build` and `generate-tiers` do not call
or compile them.

## Consequences

Public authors can start from the formats emitted by existing reconstruction and splat
tools without building Spark or relying on private frontier code. Tier decimation is
reproducible through a pinned MIT-licensed dependency, and the same input can target SOG
or SPZ.

Merge-decimation does not reproduce the exact representatives or opacity conversion of
the historical RAD tree cuts. Existing datasets may retain that workflow, and every new
minimum-playable tier still requires visual calibration. Separate temporal tier files
continue to duplicate data and do not provide inter-frame compression.
