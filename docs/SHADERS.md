# Meridian Shaders

Custom GLSL is a core pillar (BRIEF §1). This file documents the shared
plumbing contract so every shader (board, pieces, VFX) composes instead of
reinventing.

## Conventions

- Materials are created by factory functions in `apps/client/src/scene/`
  (`createBoardMaterial()`), returning `THREE.ShaderMaterial` with typed
  uniform objects.
- **Uniforms (shared names):**
  - `uTime` — seconds, written once per frame by the owning component's
    `useFrame` (single uniform write; no allocations).
  - `uQualityTier` — reserved quality switch (1 = full). No shader branches
    on it yet; it exists so adaptive quality can be added without touching
    material call sites.
- **Per-instance attributes:**
  - `aState` (float, board tiles) — visual state id from
    `tileVisuals.TILE_STATE`: 0 none, 1 hover, 2 legal, 3 selected. Written
    only through `Board`'s `paint()` choke point; never per frame.
- Instance transforms come from `instanceMatrix` — every vertex shader must
  multiply `modelMatrix * instanceMatrix`.

## Current shaders

### Board surface (`boardMaterial.ts`)

Neutral placeholder styling (final art direction arrives with the game
design cycle): radial gradient base, hashed shimmer animated by `uTime`,
top/side face separation from local Y, and state tinting (selected amber,
legal pulsing green, hover lightened). One draw call for the whole board.
