# Project TODO

This file contains only outstanding, actionable work. Completed implementation history
lives in [`CHANGELOG.md`](../../CHANGELOG.md), measured results and follow-up
experiments live in [`PERFORMANCE.md`](PERFORMANCE.md), and architecture scope lives in
the [`project summary`](../project-summary.md) and ADRs.

A task is checked only after its acceptance criteria are implemented and verified.

## Public-preview release readiness

- [ ] Configure a rights-cleared public sample through `DEFAULT_MANIFEST_URL`, then run
      and record the release acceptance pass on Quest 3: WebGPU, WebGL2 fallback,
      controllers, hand pinch, audio, XR entry/exit, and correct stereo rendering.
- [ ] Complete the pre-publication audit from
      [`PUBLICATION_AUDIT.md`](PUBLICATION_AUDIT.md): verify dependency license texts
      from a clean frozen-lockfile install, resolve publication consent for historical
      media, inspect historical environment files, and perform an owner-approved history
      rewrite if required.
- [ ] Record licensing and redistribution status for every public fixture. Add a
      representative production GLB only if its rights permit publication; the committed
      minimal glTF marker remains sufficient for automated mesh integration tests.

## Content and visual acceptance

- [ ] E03-T01 — Finalise static GS, dynamic GS, and mesh alignment using the real
      release assets. Record the accepted transforms and validate PlayCanvas static
      Streamed SOG tree granularity and culling on Quest 3.
- [ ] E03-T04 — Validate dynamic alpha and background masking at every public quality
      tier against the release background and static scene.

## Renderer, codec, and device validation

- [ ] Complete the PlayCanvas/SOG production benchmark matrix at 25%, 50%, and 100% on
      the same desktop and Quest 3 sessions:
  - [ ] Compare WebGL2 CPU sort with WebGPU GPU sort using repeated p50/p95 samples for
        preparation, sorting, GPU frame time, presented cadence, memory, and stalls.
  - [ ] Capture a full-tier Quest trace and any WebGPU XR run that reports
        `XRGPUBinding`; verify both eyes during paused and continuous WebGL2 XR
        playback.
  - [ ] Derive the target-device splat, memory, static/dynamic weighting, frame-rate,
        and concurrency budgets from the measurements.
- [ ] Complete the experimental Babylon/SPZ and Spark/SPZ comparison matrix with
      identical source frames, tiers, cache state, worker limits, and hardware:
  - [ ] Compare Babylon fused preparation, neutral decode plus native packing, and the
        documented `.splat` fallback at 25%, 50%, and 100%; record per-stage p50/p95,
        peak memory/GC, preparation throughput, mesh update, and presented cadence.
  - [ ] Repeat native half-float versus Babylon converter measurements on Quest 3 and
        visually validate covariance output.
  - [ ] Compare Babylon and Spark with identical SPZ v4 inputs, and finish the explicit
        legacy Spark SPZ v3 versus v4 comparison before deciding whether to remove v3.
  - [ ] Validate Babylon front/back handoff and the streamed-splat stereo compatibility
        patch in both Quest 3 eyes during paused and continuous playback.
- [ ] E03-T05/E13-T02 — Consolidate the renderer results into sustained streaming and
      maximum-stable-playback-rate recommendations. Include desktop, Quest 3, and a
      representative mobile Safari device; record browser, GPU, CPU, RAM, and storage.

Detailed experimental procedures and already captured baselines remain in the
[`PERFORMANCE.md` next-measurements list](PERFORMANCE.md#next-measurements).

## Player-core follow-ons

- [ ] E05-T06 — Add playback-rate support, including deadline scaling, buffer demand,
      audio synchronisation, supported-range validation, and deterministic tests.
- [ ] E05-T07 — Add the public event model beyond observable snapshots: lifecycle,
      seeking, buffering, frame presentation/drop, quality, metrics, ended, and error
      events.
- [ ] E06-T06/T09 — Complete cancellation accounting and byte-based decoded/GPU memory
      eviction. Refinement aborts, frame-count eviction, and the compressed-byte budget
      exist; cancelled work still needs distinct metrics and all resident
      representations need one enforceable memory policy.
- [ ] E13-T04 — Add independent static-refinement concurrency and include it in the
      renderer/device budget policy.

## Pilot network adaptation

- [ ] Calibrate adaptive-policy safety margin, target buffer, and downgrade/upgrade
      hysteresis for the expected sub-500-Mbps pilot path using bytes per frame rather
      than splat count as the transfer constraint.
- [ ] Validate the policy over the 6G-testbed-plus-Wi-Fi path and publish the experiment
      configuration and results. Describe throughput as client-measured; do not label it
      telemetry-assisted.

The normalised telemetry provider and `telemetry-6g` package are already retained as
deferred extension points. They are not pilot completion dependencies unless actionable
end-to-end telemetry becomes available.
