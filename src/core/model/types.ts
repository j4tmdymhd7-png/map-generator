/**
 * Canonical campaign data model.
 *
 * Everything here is plain, serializable data. UI-only state (selection,
 * hover, viewport) never lives in these types.
 */

export const SCHEMA_VERSION = 1;

export const TERRAINS = [
  'void', // solid rock / outside the dungeon
  'floor',
  'wall',
  'door', // state lives on the matching DoorObject
  'stairs',
  'pit',
  'hazard',
  'obstacle', // opaque, fills its space (pillar, boulder)
] as const;
export type Terrain = (typeof TERRAINS)[number];

/** Bit flags stored per cell alongside terrain. */
export const CellFlag = {
  Difficult: 1 << 0,
} as const;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Who may see an object or token. Player views strip everything marked 'dm'. */
export type Visibility = 'public' | 'dm';

export type DoorState = 'open' | 'closed' | 'locked';

interface BaseObject {
  id: string;
  visibility: Visibility;
  label?: string;
}

export interface RoomObject extends BaseObject {
  kind: 'room';
  rect: Rect;
}
export interface CorridorObject extends BaseObject {
  kind: 'corridor';
  cells: Point[];
}
export interface DoorObject extends BaseObject {
  kind: 'door';
  at: Point;
  state: DoorState;
}
export interface StairsObject extends BaseObject {
  kind: 'stairs';
  at: Point;
  role?: 'entrance' | 'exit';
  /** Link to stairs on another floor (separate map). */
  linkTo?: { mapId: string; objectId: string };
}
export interface NoteObject extends BaseObject {
  kind: 'note';
  at: Point;
  text: string;
}

export type MapObject = RoomObject | CorridorObject | DoorObject | StairsObject | NoteObject;

export interface GenerationRecord {
  seed: string;
  generatorVersion: number;
  params: Record<string, unknown>;
}

export interface DungeonMap {
  id: string;
  title: string;
  width: number;
  height: number;
  cellSizeFeet: number;
  /** Row-major, length width*height. */
  terrain: Terrain[];
  /** Row-major CellFlag bitmasks, length width*height. */
  flags: number[];
  objects: MapObject[];
  /** Present when the map came from the generator. */
  generation?: GenerationRecord;
}

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type Size = (typeof SIZES)[number];

export type Side = 'party' | 'enemy' | 'neutral';

export interface Speeds {
  walk: number;
  climb?: number;
  swim?: number;
  fly?: number;
  burrow?: number;
}

export interface Senses {
  darkvision?: number;
  blindsight?: number;
  tremorsense?: number;
  truesight?: number;
}

export interface Token {
  id: string;
  mapId: string;
  label: string;
  color: string;
  image?: string;
  size: Size;
  /** Top-left square of the token's footprint. */
  position: Point;
  speeds: Speeds;
  senses: Senses;
  side: Side;
  /** Lowercase condition names, e.g. 'incapacitated', 'prone'. */
  conditions: string[];
  visibility: Visibility;
}

export type DiagonalPolicy =
  /** 2024 default: every square, diagonal or not, costs 5 ft. */
  | 'uniform'
  /** Optional 5/10/5 alternating diagonals (2014 DMG variant). */
  | 'alternating';

export interface GridPolicy {
  diagonal: DiagonalPolicy;
  /** Whether closed (unlocked) doors block path previews. Locked doors always block. */
  closedDoors: 'block' | 'passable';
}

export const DEFAULT_GRID_POLICY: GridPolicy = {
  diagonal: 'uniform',
  closedDoors: 'block',
};

export interface Ruleset {
  edition: 'dnd-2024';
  /** Reference text the adapter was written against. */
  version: 'srd-5.2.1';
}

export interface Campaign {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  ruleset: Ruleset;
  maps: DungeonMap[];
  tokens: Token[];
  settings: {
    grid: GridPolicy;
  };
}
