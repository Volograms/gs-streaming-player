# ADR 0005: Make the sequence manifest player-owned

- Status: Accepted
- Date: 2026-07-14

## Context

The player, content tools, demo, and tests need one versioned description of static
objects, dynamic sequences, meshes, audio, transforms, and asset sizes.

## Decision

The versioned manifest schema is a player contract. `player-core` owns its domain model;
content tools create and validate it, and renderers receive only the resolved object or
frame inputs required for their work.

## Consequences

Renderers are not coupled to transport or authoring formats. Schema evolution requires
explicit versions and compatibility handling. E01 will select the single source of truth
used to keep JSON Schema and TypeScript types aligned.
