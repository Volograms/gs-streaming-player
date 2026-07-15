# ADR 0007: Keep coordinate conversion explicit in content transforms

- Status: Accepted
- Date: 2026-07-15

## Context

RAD capture pipelines, glTF assets, and Three.js applications can use different axis,
origin, and unit conventions. Applying a renderer-wide correction would fix some assets
while silently misaligning content that is already authored for Three.js.

## Decision

Use a right-handed Three.js world with `+Y` up and metre-based units where physical
scale is known. Keep the renderer coordinate-system neutral and express every
source-to-world conversion through the existing manifest transform. Apply a dynamic
sequence transform identically to every prepared frame.

The current Y-down/Z-forward RAD fixtures use an explicit 180-degree X rotation. This is
fixture configuration, not a default for all RAD files.

## Consequences

Static splats, dynamic splats, and meshes share one predictable transform path. Content
producers must record axes, scale, and origins, but already aligned assets are never
double-converted. Matrix transforms remain an escape hatch for calibrated alignment and
continue to override component transforms.
