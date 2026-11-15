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

**Milestone 5 — stats and loot (done).**

- **Stat blocks** on every token, all editable: AC, HP/max/temp (with Damage and Heal), the six abilities with modifiers, CR, actions and traits, and DM notes. Initiative uses DEX unless a bonus is set. The 2024 conditions show as badges on the map. HP bars appear in the DM view only, and a creature at 0 HP is crossed out. A pennant marks whose turn it is.
- **Creature library** (editable, saved in the browser): stat templates, "when unseen" behavior, whether a creature appears in random encounters and in what group size and how often, and whether it carries loot. Spawn any creature onto the map from the Tokens panel.
- **Item library** (editable, saved in the browser): gear, consumables, gems, art, magic items and quest items, each with a player-facing description and a DM-only note. "Can turn up in random loot" can be switched off (DM-placed only), and "Unique" items appear at most once per campaign.
- **Loot generation:** each new dungeon gets a hoard in the lair and chests in some rooms. Creatures that carry loot get pocket loot. Amounts scale with party level (tiers 1–4) using this project's own tuning, and magic item rarity is capped by tier. Click a chest to see the contents and edit, add, give or reroll them. "Defeated: drop loot" leaves a creature's belongings where it fell. Items move between inventories.

**Milestone 6 — map sizes (done).** Pick a size and type in the toolbar:

| Size | Types | Grid |
|---|---|---|
| Small | Tavern / inn, Manor | 28×26, 38×30 |
| Medium | Dungeon, Caves | 40×40 |
| Large | Dungeon, Cave system | 80×80 |
| Huge | Town, Forest | 120×120 |
| Gargantuan | Walled city, Wilderness | 200×200 |

- **Interiors:** the building is split recursively (BSP) into rooms with one door per split, plus a front door onto the street. Rooms get roles (common room, kitchen, guest rooms, study, library, chapel, storeroom with cellar stairs…) and matching furniture. Tables and beds are difficult terrain; counters, shelves, barrels and hearths block movement but not sight. Furniture is rolled back if it would block a doorway.
- **Forests and wilderness:** noise-based woods and undergrowth, clearings (standing stones, campsites, ruins, ponds) linked by a trail from the map edge, and a stream. Wilderness adds a lake and a river with bridges.
- **Towns and cities:** a street grid (one 3-wide avenue each way, 2-wide streets, occasional merged blocks). Each block is lined with rectangular houses fronting its streets, in varied widths and depths, with courtyards and gardens behind them reached by alleys; some alleys end at a back house. Squares near the crossroads have wells and market stalls. Cities add a two-course stone wall with a ring road inside it (houses never touch it), battlemented towers at the corners and along each side, gatehouses where the avenues leave the city (each gate is three doors you can close or lock), and a river that passes under the wall with bridges where streets cross. Houses are drawn as hip roofs with their own outlines, so neighbouring houses stay distinct.
- New terrain: ground, road, tree (blocks movement and sight), brush and shallow water (difficult), deep water (blocks walking), furniture. All of it goes through one terrain table that the rules, fog, placement and validation share.
- **Tiled renderer:** the map is drawn in 16×16-square tiles at the current zoom with per-square hashed randomness, so even 200×200 maps stay sharp and tiles line up seamlessly.

**Milestone 7 — campaigns, places and people (done).**

- **Campaigns are saved** in the browser (IndexedDB) as you play: every map, token, NPC, loot pile, door and the fog on each map. The Campaign button renames, switches and starts campaigns, and exports or imports a `.campaign.json` file for backups or moving computers. Files are checked on import (schema version 2; version 1 files are upgraded).
- **Maps in a campaign:** New map adds one from the toolbar recipe and moves the party there. Replace this map regenerates the current one. The Map menu shows them all as a tree (places nest under the map they're in) and marks where the party is. Looking at another map doesn't move the party.
- **Points of interest:** towns and cities get taverns, inns, temples, smithies, an apothecary, general stores, stables, barracks, noble estates, docks on the river, a gatehouse at each gate, the market square, and a thieves' den that only the DM sees. Wilderness clearings become standing stones, ruins, campsites, a hermit's hut, a ranger's lodge, an abandoned farm, bandit camps, shrines and a cave mouth; some shrines and caves are hidden until found (DM sets the search DC). Each kind has its own ink symbol, every place has a name, and a ◆ marks the way in. Click a place for its card: name, what players see, DM notes, who's there.
- **Going inside:** Go inside (or select a hero by the door and press E) generates the interior the first time and moves the party in: a tavern, inn, shop, smithy, temple, barracks, den, warehouse, stables, manor or cottage floor plan, or a cave or crypt under ruins. Leave (or E at the way out) returns the party to the door they came in by. Interiors are generated from the outer map's seed, so they're the same every time.
- **NPCs are reference cards** the DM plays from: name, occupation, what players call them before introductions ("Soot-streaked smith"), attitude (Friendly, Indifferent, Hostile), appearance, mannerism, want, secret, rumors and notes, all editable. Every place gets its proprietor and sometimes staff. Merchants sell from the item library ("Sell to…" hands the item over). People who work outdoors (market, bandit camps) stand at their place; indoor staff appear when the party goes in. In Player view an NPC shows by description until you tick Introduced. People & places lists everyone and every place, with search.
- **Names** come from original generic-fantasy tables. The name style is a campaign setting, ready for regional styles later.
- **Ready for simulation later:** NPC cards carry an optional daily schedule and the campaign carries a world clock; neither is acted on yet.

**Milestone 8 — player screen and a cleaner screen (done).**

- **Player screen ↗** opens a second window with only what the players may see: the map under fog, the party, creatures in sight, places they've found, and NPCs under their descriptions until introduced. No controls, HP bars, room numbers or DM-only places. It follows the DM window live (moves animate, doors and fog update) over a same-browser BroadcastChannel. Share it in Discord with Screen Share → the window.
- **Preview as players** shows the same thing in the DM window.
- One toolbar: campaign menu, map menu, New map (now a dialog), People & places, Library, View (grid, room numbers, fog), Preview, Player screen, save status and **?** help.
- Side-panel settings fold into Exploration, Loot and Random encounters sections. Instructions moved into tooltips and a **How to use** screen (shown once on first visit, then from **?**).

**Interiors, version 3 (contributed, with fixes).**

- Tables are 2×2 with chairs grouped around them, facing in, and aisles between groups. Rooms also get benches (temple pews, barracks), cabinets and rugs. Chairs and benches are difficult terrain, cabinets block movement, and rugs are just decoration.
- Every doorway keeps a clear approach square inside it.
- Taverns and inns: the common room opens onto a rear hall, and every other room has its own door off it. Inns have rooms on both sides of the hall (a passage from the common room runs between the front rooms), so they get five or more guest rooms.
- The same seed now makes a different tavern or manor than in earlier versions. Saved campaigns are unaffected, because saves keep the whole map.

Next: NPC routines and the world clock, editor tools and undo (M2b), and importing monster stats into the private library.

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
