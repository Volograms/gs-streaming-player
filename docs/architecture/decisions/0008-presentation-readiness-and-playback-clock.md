# ADR 0008: Gate presentation on current quality and use an absolute playback clock

- Status: Accepted
- Date: 2026-07-15

## Context

Spark can initialise a paged `.RAD` mesh and make its root page resident before the
frame has enough spatial detail to be shown. It can also evict pages that belonged to a
frame previously considered ready. Treating either initialisation or root residency as
playback readiness exposed a grey coarse cloud during dynamic frame handoff.

Incrementing frames from a UI `setInterval` also makes playback rate depend on async
load latency and accumulates timer drift.

## Decision

Root residency is decoder/base readiness, not presentation readiness. The renderer
adapter exposes an awaitable, renderer-neutral presentation-quality target. For paged
Spark content, a target is presentable only when its currently demanded chunks are
resident, no demanded fetch/upload/tree-update work remains, the minimum selected-splat
count is met, and the same demand remains settled across actual render turns. A mapping
revision can satisfy that fence sooner; an unchanged but already-valid coarse mapping
does not have to manufacture a revision. The buffer revalidates the condition
immediately before every handoff.

The framework-independent player core owns playback timing. It schedules absolute
deadlines from a monotonic clock. If the due frame is not presentation-ready, playback
enters `BUFFERING` and retains the current visible frame. Without an audio master, media
time pauses during that stall and resumes from a new clock anchor. Delayed timer wakes
may drop intermediate frames rather than accumulating drift.

The initial deterministic target is a configurable 0.25 detail fraction. Selected-splat
floors remain available for controlled experiments but default to zero because the valid
count is view- and budget-dependent. A later `QualityController` decision will replace
the fixed detail target using measured or testbed-supplied network state.

## Consequences

Frame changes cannot expose Spark's root-only grey representation. A frame that loses
pages is demoted and refined again rather than relying on sticky readiness.

Uninterrupted 30 fps is possible only when the selected target fits sustained transfer,
decode, upload, and GPU-page capacity. Otherwise playback explicitly buffers at a stable
frame. The fixed target provides the correctness seam needed before network-adaptive
quality is implemented.

The Spark adapter currently observes paging queues and mapping revisions exposed by
Spark 2.1.0. Upgrading Spark requires rerunning the paging-readiness integration tests.
