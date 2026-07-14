# ADR 0005: Make the sequence manifest player-owned

- Status: Accepted
- Date: 2026-07-14

## Context

The player, content tools, demo, and tests need one versioned description of static
objects, dynamic sequences, meshes, audio, transforms, and asset sizes.

## Decision

The versioned manifest schema is a player contract. `player-core` owns its domain model;
content tools create and validate it, and renderers receive only the resolved object or
frame inputs required for their work. A TypeBox schema is the typed source of truth,
while a committed JSON Schema is checked against it for non-TypeScript consumers and
editor integration.

## Consequences

Renderers are not coupled to transport or authoring formats. Schema evolution requires
explicit versions and compatibility handling. TypeScript types are inferred from the
schema, and tests reject drift in the committed JSON form.
