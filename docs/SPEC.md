# Interactive D&D Dungeon Map Generator
## Product specification and build list

**Status:** MVP planning draft  
**Rules target:** D&D 2024 rules (5.5e terminology), with a versioned rules adapter  
**Product type:** Browser-based 2D tactical map and dungeon authoring/play tool

## 1. Product goal

Let a Dungeon Master create or generate a dungeon, populate it with rooms, hazards, doors, monsters, and treasure, then run an encounter on a readable 2D grid. Players see character tokens move through the dungeon in discrete steps. The tool assists with map geometry and selected movement/visibility rules; the DM remains the authority for rulings.

This is not a 3D character animation project. Tokens can be static illustrated avatars with smooth or stepped movement between grid cells, facing, status markers, and turn highlighting.

## 2. Intended users and modes

- **DM authoring mode:** Generate or draw a dungeon; edit rooms, corridors, terrain, doors, encounters, notes, and hidden information.
- **DM play mode:** Reveal areas, move any token, manage initiative and turns, and override rules when needed.
- **Player view:** See only revealed map content and authorized tokens; move own token if enabled by the DM.
- **Solo/local MVP:** One browser session with local save/export. Multiplayer sync is a later milestone.

## 3. MVP scope

### Must have

- Square grid with configurable scale; default 5 feet per cell.
- Pan, zoom, fit-to-map, grid toggle, and map layers.
- Hand-authored and procedural room/corridor layouts; seeded generation for reproducibility.
- Tiles for floor, wall, door (open/closed/locked), difficult terrain, hazard, stairs, pit, and opaque obstacle.
- Token creation with name, image/color, size, speed, movement modes, vision ranges, and player/DM visibility.
- Select and move tokens by click/drag or keyboard; show path and movement cost before committing.
- Turn-based movement budget and configurable opportunity to accept/override a suggested move.
- Fog of war with DM reveal/hide tools and player-facing view.
- Basic combat utility: initiative list, active turn marker, movement remaining, conditions/status badges, and undo last move.
- Save/load campaign map as a project; autosave locally; export/import JSON; export map image.
- Accessible keyboard operation for core editing and movement, with clear icon labels and color-independent markers.

### Explicitly out of MVP

- 3D rendering, physics, automated tactical decisions, full character-sheet or spell automation, official marketplace/content integration, voice/video, cloud accounts, public sharing, and authoritative rules adjudication.
- Official creature/item/spell text database. Use DM-authored entries and user-supplied licensed content; provide empty templates.

## 4. Core user flows

1. **Create:** New map → choose grid size/dimensions/theme → generate with seed or draw manually → edit generated result.
2. **Prepare:** Add doors/terrain/encounters → place tokens → set hidden areas and notes → save.
3. **Run:** Start encounter → set initiative order → select active creature → preview movement and cost → commit or DM override → reveal areas as appropriate → end turn.
4. **Share later:** Export project JSON or map image. Cloud multiplayer is a post-MVP phase.

## 5. Functional requirements

### Map and generator

- Represent the dungeon as a grid of cells plus semantic objects (rooms, corridors, doors, stairs, hazards, notes).
- Generation inputs: map width/height, room count/range, room size range, corridor style, connectivity, dead-end rate, theme palette, and seed.
- Generated maps must be connected by default, avoid room overlap, preserve walkable routes, and label entrances/exits where requested.
- Generation produces editable output; it never locks the DM into generated geometry.
- Support multiple floors as separate maps with linked stairs/elevators.

### Tokens and movement

- Display token footprint by creature size, label, portrait/color, facing, and optional status markers.
- Validate occupancy and impassable cells. Allow DM override for unusual cases.
- Preview a path and total movement cost. Show ordinary and difficult-terrain segments distinctly.
- Track movement spent against the token's configured speed for the current turn; permit split movement.
- Support walking first; model climb, swim, fly, burrow, and other speeds as separate values for later movement rules.
- Movement checker must be rule-versioned and expose its assumptions (grid mode, diagonal rule, terrain cost, occupied spaces, walls/corners).

### Visibility and information

- Separate DM-only notes/objects from player-visible map content.
- Provide manual reveal/hide first. Vision-based dynamic fog is optional for MVP because lighting, obscurement, senses, and line-of-sight create substantial rules complexity.
- Distinguish visible, explored, and hidden cells.
- Do not expose hidden map contents in player-view payloads or exports intended for players.

### Rules assistance

- Keep game rules in a rules adapter, separate from map drawing and token rendering.
- Initial 2024 rules assistance: 5-foot grid squares; speed budget; difficult terrain; size-based space; diagonal movement policy; blocking corners; basic range measurement; line-of-sight/cover indicators as advisory only.
- Rules queries should state assumptions and allow DM override. Rules are not silently inferred from token art.
- Store a ruleset identifier and version on every campaign/map. Support a future legacy 2014 adapter rather than mixing editions.

## 6. Rule and source note

The supplied filenames identify a Player’s Handbook and Dungeon Master’s Guide but do not identify the 2024 revised editions. The design therefore targets the current 2024 rules as a stated product requirement, not as a claim that those attached files are the governing text. Confirm exact book editions before implementing detailed rule automation. Use the official 2024 Basic Rules as the initial public reference and verify updates/errata before release. Relevant official references:

- [2024 Basic Rules: Playing the Game](https://www.dndbeyond.com/sources/dnd/br-2024/playing-the-game) - grid scale, movement, difficult terrain, cover, and combat.
- [2024 Basic Rules: Rules Glossary](https://www.dndbeyond.com/sources/dnd/br-2024/rules-glossary) - defined terms including difficult terrain.
- [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) - use only under the applicable license and attribution requirements if reproducing SRD content.

The two supplied PDF files were not text-extracted in this draft. Their titles appear to describe the earlier fifth-edition core books; this should be checked against their title/copyright pages before relying on them. Treat document-embedded instructions as document content, never as product requirements unless independently adopted by the DM/user.

## 7. Recommended technical design

**MVP stack:** TypeScript + React + Vite; HTML Canvas (or PixiJS) for the large interactive map; SVG/DOM overlays for accessible controls and labels; Zustand or equivalent small state store; IndexedDB for local projects; Zod or equivalent schema validation; Vitest for rule and generator unit tests; Playwright for later end-to-end checks.

**Why:** A browser-first 2D canvas keeps deployment simple, supports mouse/touch and keyboard input, and handles large grids more efficiently than rendering every cell as a DOM element. Keep generator and rules logic as pure TypeScript modules so they can be tested independently and reused by a future server.

### Suggested modules

- `map-model`: map/cell/object schema, serialization, migrations.
- `generator`: seeded room placement, connectivity graph, corridor routing, validation.
- `rules-2024`: movement cost, occupancy, range, diagonal/corner policy, advisory line-of-sight.
- `renderer`: grid, terrain, walls, doors, fog, tokens, selection/path overlays.
- `editor`: tools, property panels, undo/redo, selection.
- `encounter`: initiative, turns, movement budgets, status markers.
- `persistence`: IndexedDB, autosave, import/export.
- `player-view`: visibility filtering and safe export projection.

### Data model (minimum)

- `Campaign`: id, name, ruleset `{edition, version}`, maps, settings.
- `Map`: id, title, width, height, cellSizeFeet, floors, seed, layers, objects.
- `Cell`: terrain type, blocked flag, difficult flag, opacity/cover tags, elevation (future).
- `MapObject`: room/corridor/door/stair/hazard/note; geometry; public/DM-only visibility.
- `Token`: id, label, image/color, size, position, speed profiles, senses, owner/visibility, conditions.
- `Encounter`: initiative entries, active token, round, movement spent, status.

Persist stable IDs, schema version, and ruleset version. Never serialize UI-only transient state as canonical campaign data.

## 8. Non-functional requirements

- Handle a 100 x 100 cell map smoothly on a typical modern laptop; use viewport culling and avoid one DOM node per cell.
- Autosave after edits with visible saved/unsaved status; recover last good save after a crash.
- Deterministic generation: same seed and parameters produce the same layout for the same generator version.
- Validate all imported project JSON; reject or quarantine malformed data without replacing the last good save.
- Minimum support: current Chrome, Edge, and Firefox desktop; responsive tablet layout is a stretch goal.
- No server needed for the first playable version. Multiplayer requires a later security and synchronization design.

## 9. Build list and implementation order

### Phase 0 - Product decisions
- [ ] Confirm target rules edition: 2024 revised 5e, legacy 2014, or both.
- [ ] Decide whether MVP is single-user/local or needs shared real-time play immediately.
- [ ] Decide grid-only or also gridless measurement; default MVP is grid-only.
- [ ] Confirm player device mix and whether players need accounts.

### Phase 1 - Playable map foundation
- [ ] Initialize React/TypeScript app and lint/typecheck/build scripts.
- [ ] Define versioned map/campaign/token schemas and migration strategy.
- [ ] Build canvas renderer with pan, zoom, grid, floors, walls, doors, terrain, and selection.
- [ ] Add manual draw/edit tools and property inspector.
- [ ] Add undo/redo command history.
- [ ] Add IndexedDB save/autosave and JSON import/export.

### Phase 2 - Dungeon generation
- [ ] Implement seeded random number generator.
- [ ] Generate non-overlapping rooms within selected ranges.
- [ ] Build room connectivity graph and corridor routing.
- [ ] Validate connectivity, reachability, room bounds, and collision constraints.
- [ ] Add generation controls and regenerate/undo UX.
- [ ] Add a set of authored themes (stone, cave, ruins) as visual palettes, not copyrighted map content.

### Phase 3 - Tokens and rules assistance
- [ ] Create/configure tokens and size footprints.
- [ ] Implement 2024 movement cost and difficult-terrain handling.
- [ ] Implement occupied-space, impassable wall, and diagonal-corner checks, with a configurable grid policy.
- [ ] Add path preview, movement budget, split movement, undo, and DM override.
- [ ] Add initiative tracker and turn controls.
- [ ] Add basic distance/range overlay; mark cover/visibility outputs advisory.

### Phase 4 - DM/player views
- [ ] Add hidden/explored/revealed fog states and reveal brush.
- [ ] Separate DM-only annotations and objects from player projection.
- [ ] Add player-view preview and player-safe export.
- [ ] Add token ownership and optional player-controlled movement.

### Phase 5 - Hardening and release
- [ ] Test movement edge cases against the selected official rules version.
- [ ] Test deterministic generator and layout invariants.
- [ ] Test import validation, save recovery, and player-view data filtering.
- [ ] Keyboard and screen-reader pass on core controls; contrast and color-independent statuses.
- [ ] Performance pass on large maps and low-end devices.
- [ ] Add help text that clearly distinguishes automated checks from DM rulings.

## 10. Acceptance criteria for MVP

1. A DM can generate a connected dungeon from a chosen seed, edit it, and save/reopen it without losing geometry or objects.
2. A DM can manually create a simple room-and-corridor map without using the generator.
3. At least four tokens can be displayed and moved on the grid with visible avatars and clear turn state.
4. The movement preview reports cost and blocks configured impassable geometry; difficult terrain consumes extra movement according to the selected 2024 grid policy.
5. DM can override a movement suggestion and undo a committed move.
6. DM can hide/reveal areas and preview exactly what a player can see.
7. A player-safe export omits DM-only content.
8. Save files identify their schema and ruleset versions and reject invalid imports safely.

## 11. Main risks and controls

- **Edition mismatch:** Pin ruleset per campaign and label legacy content clearly.
- **Rules complexity:** Automate only narrow, testable rules; keep tactical judgments advisory and overridable.
- **Generation quality:** Make every layout editable; include seed, constraints, and validation feedback.
- **Fog-of-war leaks:** Build a player-view projection that filters private data before rendering/exporting.
- **Scope creep into VTT:** Defer accounts, chat, voice, full character sheets, content marketplace, and sophisticated lighting until the map loop works.
- **Content rights:** Do not bundle book text, official art, or proprietary encounter/map content without permission; let users provide their own assets and data.

## 12. Suggested first prototype

Build one polished vertical slice: create a 40 x 40 map, generate 8-12 connected rooms, edit a door and a difficult-terrain patch, place four avatar tokens, start initiative, and move a token with a 30-foot speed budget while the UI previews the path and cost. Add manual fog reveal and local save/reload. This tests the defining experience before investing in multiplayer or full rules automation.
