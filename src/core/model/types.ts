/**
 * Canonical campaign data model.
 *
 * Everything here is plain, serializable data. UI-only state (selection,
 * hover, viewport) never lives in these types.
 */

export const SCHEMA_VERSION = 2;

export const TERRAINS = [
  'void', // solid rock / outside the dungeon
  'floor',
  'wall',
  'door', // state lives on the matching DoorObject
  'stairs',
  'pit',
  'hazard',
  'obstacle', // opaque, fills its space (pillar, boulder)
  // Outdoors
  'ground', // open earth or grass
  'road', // paved or packed road, trail
  'tree', // trunk and canopy: blocks movement and sight
  'brush', // undergrowth: difficult terrain
  'water', // shallow water: difficult terrain
  'deepwater', // too deep to wade: blocks walking (swim later)
  // Interiors
  'furniture', // counters, shelves, hearths: block movement, not sight
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

export const ROOM_SHAPES = ['rect', 'round', 'cross', 'cave'] as const;
export type RoomShape = (typeof ROOM_SHAPES)[number];

export interface RoomObject extends BaseObject {
  kind: 'room';
  /** Bounding box. Non-rect shapes fill only part of it. */
  rect: Rect;
  shape?: RoomShape;
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

export const ITEM_CATEGORIES = ['coins', 'gear', 'consumable', 'gem', 'art', 'magic', 'quest'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * A quantity of an item somewhere (a chest, a pile, a creature's pack). It is
 * a snapshot: editing the item library later doesn't rewrite loot already placed.
 */
export interface ItemStack {
  id: string;
  name: string;
  category: ItemCategory;
  qty: number;
  /** Value of one, in gold pieces. */
  valueGp?: number;
  rarity?: Rarity;
  description?: string;
  /** DM-only note (quest hooks, lore, who it belonged to). */
  dmNote?: string;
  /** Library item this came from, if any. */
  defId?: string;
}

export interface LootObject extends BaseObject {
  kind: 'loot';
  at: Point;
  container: 'chest' | 'pile';
  items: ItemStack[];
}

export const FURNITURE_TYPES = ['table', 'bed', 'counter', 'shelf', 'barrel', 'hearth', 'stall', 'well'] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

/** Drawn furniture. Its squares are 'furniture' terrain (solid) or difficult floor (tables, beds). */
export interface FurnitureObject extends BaseObject {
  kind: 'furniture';
  rect: Rect;
  type: FurnitureType;
}

/** A drawn structure over 'wall' squares: a house, a stretch of city wall, or a tower. */
export interface StructureObject extends BaseObject {
  kind: 'structure';
  rect: Rect;
  type: 'building' | 'wall' | 'tower';
}

/** Points of interest: named places that matter in towns and the wilds. */
export const POI_TYPES = [
  // Town and city
  'tavern',
  'inn',
  'temple',
  'smithy',
  'market',
  'barracks',
  'estate',
  'thieves-den',
  'docks',
  'apothecary',
  'stables',
  'gatehouse',
  'general-store',
  // Wilderness
  'bandit-camp',
  'hermit-hut',
  'shrine',
  'cave-mouth',
  'abandoned-farm',
  'ranger-lodge',
  'ruins',
  'standing-stones',
  'campsite',
] as const;
export type PoiType = (typeof POI_TYPES)[number];

/**
 * A named place. `at` is the square outside its entrance (where the party
 * stands to go in); `rect` is the building or area it covers.
 * DM-only (visibility 'dm') places don't show in Player view: hidden places
 * stay that way until the party finds them.
 */
export interface PoiObject extends BaseObject {
  kind: 'poi';
  poiType: PoiType;
  name: string;
  at: Point;
  rect?: Rect;
  /** What players learn on arrival. */
  description?: string;
  dmNotes?: string;
  /** Search DC to find a hidden place (DM reference). */
  searchDc?: number;
  /** Interior map generated on first entry. */
  link?: { mapId: string };
}

export type MapObject = RoomObject | CorridorObject | DoorObject | StairsObject | NoteObject | LootObject | FurnitureObject | StructureObject | PoiObject;

/** How a map is drawn: rock-and-corridor dungeon, building interior, or outdoors. */
export type MapStyle = 'dungeon' | 'interior' | 'outdoor';

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
  style?: MapStyle;
  /** Where the party starts, when there are no entrance stairs. */
  spawn?: Point;
  /** For a building interior or a cave under a map: the place it was entered from. */
  parent?: { mapId: string; poiId: string };
  /** What the generator was asked for (shown in the toolbar). */
  recipe?: { size: string; kind: string };
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

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

/** A DM-editable stat block. Kept deliberately small; free text covers the rest. */
export interface StatBlock {
  ac: number;
  hp: number;
  maxHp: number;
  tempHp?: number;
  abilities: Record<Ability, number>;
  /** Challenge rating as written ("1/4", "5"). */
  cr?: string;
  /** Actions, traits, spells: free text. */
  actions?: string;
  notes?: string;
}

export interface Senses {
  darkvision?: number;
  blindsight?: number;
  tremorsense?: number;
  truesight?: number;
}

/**
 * How a creature acts when the party can't see it.
 * wander: roams freely; guard: roams but stays within `leash` squares of `home`; still: stays put.
 */
export const BEHAVIORS = ['wander', 'guard', 'still'] as const;
export type Behavior = (typeof BEHAVIORS)[number];

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
  /** Added to a d20 roll for initiative. */
  initiativeBonus?: number;
  behavior?: Behavior;
  /** Center of a guard's territory. */
  home?: Point;
  /** Max squares a guard roams from home. */
  leash?: number;
  stats?: StatBlock;
  inventory?: ItemStack[];
  /** Creature library template this was made from. */
  templateId?: string;
  /** The NPC card this token stands for. */
  npcId?: string;
}

/** 2024 rules: a creature's attitude toward the party. */
export const ATTITUDES = ['friendly', 'indifferent', 'hostile'] as const;
export type Attitude = (typeof ATTITUDES)[number];

/**
 * A notable non-player character: a reference card the DM plays from.
 * NPCs live on the campaign, not a map, so they can move between maps.
 */
export interface Npc {
  id: string;
  name: string;
  occupation: string;
  /** What players call them before they're introduced ("Burly blacksmith"). */
  descriptor: string;
  /** Introduced: players see the name instead of the descriptor. */
  known: boolean;
  attitude: Attitude;
  appearance: string;
  mannerism: string;
  want: string;
  secret: string;
  /** Rumors and hooks they can share. */
  rumors: string[];
  notes?: string;
  /** Map and place where they work, and where they live. */
  mapId?: string;
  workPoiId?: string;
  homePoiId?: string;
  /** Item library ids they sell. */
  shop?: string[];
  /**
   * Reserved for the daily-routine simulation: where they are at each time
   * of day (minutes since midnight). Not acted on yet.
   */
  schedule?: { at: number; poiId: string }[];
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

export const NAME_STYLES = ['generic'] as const;
export type NameStyle = (typeof NAME_STYLES)[number];

export interface CampaignSettings {
  grid: GridPolicy;
  partyLevel?: number;
  nameStyle?: NameStyle;
}

export interface Campaign {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  ruleset: Ruleset;
  maps: DungeonMap[];
  tokens: Token[];
  settings: CampaignSettings;
  /** The map on screen when the campaign was saved. */
  activeMapId?: string;
  /** Explored squares per map, run-length encoded (see encodeFog). */
  fog?: Record<string, string>;
  npcs?: Npc[];
  /** World time. Reserved for the simulation; kept so saves carry it forward. */
  clock?: { day: number; minute: number };
  updatedAt?: string;
}
