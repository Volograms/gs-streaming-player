# Automatic dynamic quality

The showcase uses `GaussianStreamingPlayer` and starts in automatic mode. Select Auto in
its quality menu, or call `player.setQualityMode({ mode: "automatic" })`. Playback
retains the manifest's fixed frame rate, such as 25 or 30 fps; adaptation changes the
per-frame representation, not the playback speed.

## Tier selection

For independently addressable tiers, the player builds a ladder from the quality levels
common to every frame. The manifest's `minimumPlayable` tier is the floor; without that
marker, the lowest common tier is the floor. Small differences in measured detail ratios
between frames do not split one authored level into many levels. Tier costs use mean
`qualityLevels[].byteSize` across the sequence, not splat-count ratios.

The default policy can progress through the complete ladder, including 100%. It uses 75%
of measured aggregate throughput as its transfer budget and compares each candidate's
bytes per frame with the sequence frame rate. A healthy ready reserve must cover at
least 70% of the configured future window. This threshold also fits smaller windows and
the remaining frames near a non-looping clip's end.

Upgrades proceed one tier at a time, after at least two seconds of sustained headroom
and three distinct observations. Reserve loss, dropped presentations, or sustained
rendering below the source frame rate can reduce quality even on a fast connection.
Buffer starvation and an unaffordable current tier cause prompt downgrades. A brief
Play/resume transition with an already healthy reserve does not force a downgrade.
Paused time and repeated synchronous callbacks do not earn an upgrade.

Higher tiers without byte-size metadata are not automatically selected. Without fresh
network evidence, the policy holds its tier unless playback pressure requires a lower
one. Explicit manual selection remains available. Progressive content without an
authored fixed-tier ladder retains the existing progressive policy.

## Switching without discarding the reserve

Automatic changes retain prepared fixed-tier frames and consume them on the timeline.
New work uses the selected tier; a retained frame is replaced after its next
presentation and safe handoff, or when it leaves the rolling window. The window may
therefore contain mixed tiers briefly. This also allows a short clip entirely resident
in the ring to adopt a new tier on its next loop. Manual selection retains its explicit
replacement behavior.

## Throughput evidence

The client estimator divides delivered bytes by the union of overlapping transfer
intervals. Concurrent requests contribute together; disjoint requests are not treated as
simultaneous capacity. Intentional idle gaps between batches do not lower the active
delivery estimate. Short and long windows provide a conservative estimate; observations
age out after ten seconds by default.

The player excludes its compressed-cache hits and browser cache hits positively
identified by Resource Timing. Cross-origin responses should expose
`Timing-Allow-Origin` so cache evidence is available. Zero transfer size alone cannot
identify a cache hit when cross-origin timing is hidden; see the
[Resource Timing cache detection guidance](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/transferSize#checking_if_a_cache_was_hit).
This measures client payload delivery, not Wi-Fi link speed.

## Custom policy

`BufferAwareQualityController` accepts `dynamicQualityLevels` entries containing
`detailLevel` and optional `estimatedFrameBytes`. Filter that list to the intended
playable floor. `safetyFactor`, `targetBufferSeconds`, `upgradeDelayMs`, and
`upgradeObservationCount` customize the reserve and upgrade rules. Supply the controller
through `GaussianStreamingPlayer.create({ qualityController, ... })`; include monotonic
`PlayerMetrics.timestampMs` when driving the controller directly.

The low-level ring's
`setPresentationQualityTarget(target, { preservePreparedFrames: true })` enables the
same gradual fixed-tier switching for custom integrations.

The automated checks cover real player/buffer/fetch scheduling with simulated 25/30 fps
playback, slow-link recovery, manual selection, and bounded frame retention. Quest
thresholds and sustained decoding/sorting capacity still require device measurements.
