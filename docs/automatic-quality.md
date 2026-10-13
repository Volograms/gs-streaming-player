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
bytes per frame with the sequence frame rate. Measured active preparation capacity also
constrains the candidate tier, accounting for decoder concurrency. Downloaded frame data
is measured separately: the default player targets five seconds and keeps prefetching
beyond that target up to its 200 MB compressed byte budget. A candidate tier must fit
the target reserve plus its current payload in that budget. Short clips and the
remaining non-looping timeline limit the required reserve; a completely cached looping
clip can be reused every cycle.

After at least two seconds of sustained headroom and three distinct observations, Auto
selects the highest tier affordable within the measured transfer and memory budgets.
Upgrades can happen while the reserve is still filling: startup-ready decoded frames and
half a second of downloaded data suffice to begin observing headroom. Five seconds is a
reserve target, not an upgrade gate. Downloaded reserve loss, sustained presentation
loss, or sustained rendering below the source frame rate can reduce quality even on a
fast connection. Buffer starvation and an unaffordable current tier cause prompt
downgrades by one available authored tier at a time, including when the decoded reserve
is empty. Further downgrades wait at least two seconds for recovery. Fixed-tier
preparation keeps at least two slots active during starvation; it does not halve decode
capacity just because the reserve is low. A brief Play/resume transition with an already
healthy reserve does not force a downgrade. Isolated dropped frames do not continually
reset upgrade progress; more than 5% loss over the last second signals pressure, with
one late frame tolerated. Brief render-FPS dips also leave upgrade progress intact;
rendering below the source rate for 750 ms signals sustained pressure. Repeated
synchronous callbacks do not earn an upgrade.

If conservative speed estimates keep Auto at Preview or another low tier, a recovery
probe can try the next available tier. It requires five seconds of stable or growing
decoded reserve, at least one second decoded and two seconds downloaded (bounded by the
configured window), and no sustained rendering or presentation pressure. The selected
tier must have reached the screen before that observation starts. This also allows
recovery when cached playback has no fresh network samples. The candidate must still
have byte-size metadata and fit the compressed memory budget. After a probe, further
upgrades wait at least ten seconds, so a failed attempt cannot immediately bounce back
up. Downgrades remain active throughout; longer configured `upgradeDelayMs` values also
extend the recovery observation period.

While paused, Auto prepares the highest available authored tier without a presentation
deadline, including replacing the displayed lower-quality frame. Missing tiers fall back
normally. Preparation and prefetch continue while paused; a periodic policy tick also
handles changes after transfer activity stops. Resuming playback re-evaluates
throughput, preparation and rendering budgets.

A newly selected tier gets time to build its downloaded reserve while it continues to
grow and decoded playback remains healthy. A full cache fetches at the consumption rate;
that demand-limited throughput alone does not force a downgrade. Reserve loss or decode
and rendering pressure still reduce quality, and a stalled reserve warm-up loses its
allowance after two seconds without growth. Fixed tiers that already meet their detail
target become ready immediately, without waiting for other base downloads or refinement.

During playback, higher tiers without byte-size metadata are not automatically selected.
Without fresh network evidence, upgrades use the guarded one-tier recovery probe above.
Explicit manual selection remains available. Progressive content without an authored
fixed-tier ladder retains the existing progressive policy.

Missing fixed-tier assets (HTTP 404/410) remove that tier from the session's available
ladder. Fetching and preparation continue at an available tier above the manifest floor;
Auto selects the highest remaining tier its budgets allow. Missing assets do not trigger
repeated requests for the same unavailable tier on every frame. Other transfer or decode
errors remain distinguishable from an absent quality tier.

## Switching without discarding the reserve

Automatic quality changes keep all already prepared frames within the rolling memory
budget. Upgrades also finish work already queued for the decoded window. The higher tier
is prepared for new frames entering at the window's tail as playback consumes the
existing reserve; an upgrade does not clear or rebuild that reserve. With five seconds
already buffered, the higher quality therefore reaches the screen about five seconds
later. Downgrades retain prepared frames but replace pending work at the lower tier.

Prefetch and memory estimates account for the retained payloads at their original tier.
Larger new frames wait for room as old frames are consumed, and the old image's safe
handoff does not evict an unplayed decoded frame merely to match a shorter future
window. Render-FPS and dropped-frame pressure from retained frames cannot trigger a
downgrade of a selected tier that has not reached the screen yet. Download and
decoded-reserve pressure still apply during that transition. A retained frame is
replaced after its next presentation and safe handoff, or when it leaves the rolling
window. The window may therefore contain mixed tiers while the old reserve drains. This
also allows a short clip entirely resident in the ring to adopt a new tier on its next
loop. Manual selection retains its explicit replacement behavior. Paused Auto and manual
changes refresh the current image at the same media position, keeping the previous image
visible until replacement is ready.

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
through `GaussianStreamingPlayer.create({ qualityController, ... })`. The default facade
also accepts `buffer.targetBufferSeconds`, `buffer.compressedBufferMaximumBytes` and
`buffer.decodedBufferMaximumBytes`; include monotonic `PlayerMetrics.timestampMs` when
driving the controller directly.

Supply `PlayerMetrics.presentedDynamicDetailLevel` when the displayed authored tier can
lag behind a decision. The facade reads it from the active buffered frame;
`BufferedFrame.transferDetailLevel` records that payload's authored detail.

The low-level ring's
`setPresentationQualityTarget(target, { preservePreparedFrames: true })` enables the
same gradual fixed-tier switching for custom integrations.

The automated checks cover real player/buffer/fetch scheduling with simulated 25/30 fps
playback, slow-link recovery, manual selection, and bounded frame retention. Quest
thresholds and sustained decoding/sorting capacity still require device measurements.
