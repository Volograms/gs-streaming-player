# ADR 0017: Drive the 6G explainer from the presented frame time

- Status: Accepted
- Date: 2026-09-25

## Context

The 6G showcase adds an explainer layer: a small demo object and cheap teaching visuals
that change in sync with the presenter's talk. Viewers can seek, pause and loop, and
dynamic frames can stall while the audio clock continues. Event-sequenced animation
would leave the layer in a state that depends on history rather than on what is on
screen, and hard-coded timings would make retiming a code change.

## Decision

Cue timings live in a data file (`apps/6g-showcase/explainer/cues.json`) and are
evaluated by `@6g-path/cue-timeline`, a new package with no workspace dependencies. The
package holds no renderer or player code. The whole explainer state is a pure function
of one media time. That time is the playback clock clamped to the interval of the
presenter frame actually on screen.

Views that draw the explainer live in `apps/6g-showcase` and use PlayCanvas directly
through the adapter's application. They move into a package only if another app needs
them. The explainer's assets and index (`explainer-assets.json`) are separate from the
player manifest. The manifest format is unchanged.

Demo-object assets are prepared offline by `gs-content build-explainer` from an
OpenSplat run. Every checkpoint is written in one Y-up stage frame and preloaded; no
splat file is loaded mid-experience.

## Consequences

Seeking, pausing, looping and buffering stalls give the same explainer state as playing
up to that time, and this can be tested without WebGL. Beats are retimed by editing
JSON. `player-core` needs no API change because the app derives frame intervals from
public sequence timestamps.

The explainer's visual vocabulary (cue types and their params) is owned and validated by
the app, not by the package. The explainer is specific to the 6G showcase and is not
part of the public player surface.
