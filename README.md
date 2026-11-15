# Dungeon Map Generator

A browser-based 2D dungeon authoring and encounter tool for D&D (2024 rules). Generate or draw a dungeon, place tokens, and run movement on a grid with rules-aware previews. The DM is always the final authority. See [`docs/SPEC.md`](docs/SPEC.md) for the full product spec.

## Status

**Milestone 1 — core engine (done).** Pure TypeScript, fully unit-tested, no UI dependencies:

- `src/core/model` — versioned campaign/map/token types, Zod import validation, grid helpers
- `src/core/rules` — D&D 2024 rules adapter + rules-agnostic pathfinder
- `src/core/generator` — seeded room-and-corridor generator + structural validator
- `src/core/rng.ts` — deterministic seeded PRNG

**Milestone 2a — pen-and-ink renderer (done).** `src/renderer`:

- `ink.ts` draws walls as hand-inked lines, crosshatched rock, paper grain, numbered rooms, and symbols for doors (closed, open, locked), stairs, pits, hazards, pillars and rubble (difficult terrain). It is deliberately monochrome, so meaning is carried by line and symbol, not color.
- `MapView.tsx` adds pan (drag or arrow keys), zoom (wheel, pinch, or +/−), fit (0), and a hovered-square readout. The map is rasterized to a cached bitmap and re-sharpened after zooming.

Next: editor tools and undo (M2b), tokens/initiative/movement UI (M3), fog of war + player view window (M4), then the vertical-slice playtest (M5).

## Scripts

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run typecheck
npm run lint
npm run build
```

## Rules assistance (D&D 2024)

Movement previews follow the 2024 grid rules, and every preview can list its assumptions (`describeAssumptions`):

- 5-ft squares; Speed is spent in 5-ft steps.
- Diagonals cost the same as orthogonal squares by default; an optional 5/10 alternating variant is a campaign setting.
- Difficult Terrain doubles the cost of entering a square.
- Diagonal moves can't cut the corner of a wall, obstacle, or closed door.
- Creatures can pass through allies, Tiny or Incapacitated creatures, or creatures two sizes larger/smaller. Non-ally, non-Tiny spaces count as Difficult Terrain, and a move can't end in an occupied space.
- Closed doors block previews by default (configurable); locked doors always block.
- Paths never route through pits/hazards, but a DM may choose one as a destination (flagged with a warning).
- Range is counted from a square adjacent to one creature to the other's space.

All checks are advisory and overridable. Rules live only in `src/core/rules/dnd2024.ts`; a future 2014 adapter would sit beside it rather than mixing editions.

## Generator

`generateDungeon(seed, params)` places non-overlapping rooms, connects them with a minimum spanning tree plus optional loops, carves L-shaped corridors and dead-end spurs, wraps everything in walls, adds doors at 1-wide room entrances, and marks entrance/exit stairs. The same seed + params + `GENERATOR_VERSION` always produces the same map. Bump `GENERATOR_VERSION` whenever a change would alter existing seeds.

## Content and licensing

This project bundles no book text, official art, or proprietary maps. Rules behavior is implemented from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.
