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

**Milestone 3a — avatar tokens (done).**

- Tokens show an uploaded portrait (center-cropped and shrunk to about 256 px WebP so saves stay small) or the character's initials. Party, enemy and neutral are told apart by ring style (solid, spiked, dashed), not by color.
- Footprints follow creature size. Name banners appear once you're zoomed in.
- Select a token to see every square it can still reach this turn. Hover a square to see the path, step markers (hollow squares mark difficult terrain) and the cost in feet.
- Click to move: the token hops square by square along the path. Arrow keys plus Home/PgUp/End/PgDn move one square at a time. Shift-click is the DM override. There's undo and a "new round" reset.
- The side panel adds and removes tokens and sets portrait, name, side, size, speed and color.

**Milestone 4a — doors, fog of war, random encounters (done).**

- **Doors:** tokens open closed doors as they walk through (a setting). Click or right-click a door to open or close it, press O next to one, or Shift-click to lock or unlock (DM). Locked doors always block.
- **Fog of war:** line of sight from party tokens within a sight range (30–120 ft). Walls, closed doors and pillars block sight, and you can't peek diagonally past corners. Squares are hidden, explored (dimmed) or visible. The fog lifts square by square as tokens walk.
- **Player view:** unexplored squares are fully black, and non-party tokens only appear while someone can see them. The hover readout, path previews and token list never reveal what's hidden. DM view sees through the fog. Reveal-map and re-shroud buttons are included.
- **Random encounters:** roll one now, or check each new round (off, 1 in 6, 1 in 4, 1 in 2). Monsters are placed in a room nobody has seen, at least 8 squares from the party. The creature table is a placeholder until real monster data is loaded.

**Milestone 4b — turns and wandering monsters (done).**

- **Exploration rounds:** a round counter, and Next round (or N) resets everyone's movement.
- **Combat:** Start combat rolls d20 + initiative bonus for the party and every creature they can see. The turn order is editable. End turn (or N) advances it and auto-selects whoever's up, resetting their movement. Creatures can join mid-fight, and End combat returns to exploration.
- **Wandering:** between rounds, creatures the party can't see may move up to their speed. They only travel through squares the party can't see and never open doors, so wandering doesn't give itself away. Each creature has a "when unseen" behavior: wanders, guards an area (stays within N squares of home, like the demo Ogre and Goblin Boss guarding their lair), or stays put.

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

`generateDungeon(seed, params)` (generator v2):

- **Themes:** `dungeon` (built rooms, doors, straight passages) or `cave` (ragged caverns, winding tunnels, no doors).
- **Room shapes:** rectangle, round, cross and cavern.
- **Corridors** are routed by cost: they reuse earlier passages, keep clear of other rooms' walls, avoid running alongside each other, and prefer straight runs in dungeons.
- **Furnishings:** colonnades, rubble (difficult terrain), pits and statues. Each is rolled back if it would cut a room off from its entrances.
- Rooms are connected with a minimum spanning tree plus optional loops, with dead-end spurs, doors at 1-wide entrances, and entrance/exit stairs.
- A test walks a Medium creature from the entrance to every room across 80 seeds of each theme. The same seed + params + `GENERATOR_VERSION` always produces the same map. Bump `GENERATOR_VERSION` whenever a change would alter existing seeds.

## Content and licensing

This project bundles no book text, official art, or proprietary maps. Rules behavior is implemented from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.
