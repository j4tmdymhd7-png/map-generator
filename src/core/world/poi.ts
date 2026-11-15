/**
 * Points of interest: which buildings and clearings matter, what they are
 * called, and what's inside.
 *
 * Runs after the town and forest generators, on its own random stream, so
 * placing places never changes the streets or trees of a seed.
 */
import { idx, ORTHOGONAL, rectCenter } from '../model/grid';
import type { DungeonMap, FurnitureObject, NameStyle, Point, PoiObject, PoiType, Rect, RoomObject, StructureObject, Terrain } from '../model/types';
import { createRng, type Rng } from '../rng';
import { familyName, holyName, personName, signName } from './names';

/** What a place opens into when the party goes in. */
export type InteriorKind = 'tavern' | 'inn' | 'manor' | 'shop' | 'smithy' | 'temple' | 'barracks' | 'den' | 'warehouse' | 'stables' | 'cottage';
export type PoiInside = { interior: InteriorKind } | { underground: 'cave' | 'crypt' } | null;

export interface PoiInfo {
  label: string;
  inside: PoiInside;
  /** Item categories sold by the proprietor (merchants only). */
  sells?: ('gear' | 'consumable' | 'magic')[];
  /** One-line description players get on arrival. */
  blurb: string;
}

export const POI_INFO: Record<PoiType, PoiInfo> = {
  tavern: { label: 'Tavern', inside: { interior: 'tavern' }, blurb: 'Smoke, noise and the smell of ale spill into the street.' },
  inn: { label: 'Inn', inside: { interior: 'inn' }, blurb: 'A sign promises clean beds and a hot meal.' },
  temple: { label: 'Temple', inside: { interior: 'temple' }, blurb: 'Tall doors, worn steps and the murmur of prayer.' },
  smithy: { label: 'Smithy', inside: { interior: 'smithy' }, sells: ['gear'], blurb: 'The ring of a hammer and a wave of heat from the forge.' },
  market: { label: 'Market', inside: null, blurb: 'Stalls, haggling and every kind of goods on display.' },
  barracks: { label: 'Barracks', inside: { interior: 'barracks' }, blurb: 'Guards come and go; a notice board hangs by the door.' },
  estate: { label: 'Noble estate', inside: { interior: 'manor' }, blurb: 'A grand house behind a well-kept front.' },
  'thieves-den': { label: "Thieves' den", inside: { interior: 'den' }, blurb: 'A shabby house with shuttered windows.' },
  docks: { label: 'Docks', inside: { interior: 'warehouse' }, blurb: 'Crates, rope and boats tied up along the water.' },
  apothecary: { label: 'Apothecary', inside: { interior: 'shop' }, sells: ['consumable'], blurb: 'Jars of dried herbs fill the window.' },
  stables: { label: 'Stables', inside: { interior: 'stables' }, blurb: 'Horses stamp and a stable hand forks hay.' },
  gatehouse: { label: 'Gatehouse', inside: { interior: 'barracks' }, blurb: 'Guards watch everyone who passes through the gate.' },
  'general-store': { label: 'General store', inside: { interior: 'shop' }, sells: ['gear', 'consumable'], blurb: 'Shelves of rope, lanterns, rations and odds and ends.' },
  'bandit-camp': { label: 'Bandit camp', inside: null, blurb: 'Tents around a fire pit, and lookouts in the trees.' },
  'hermit-hut': { label: "Hermit's hut", inside: { interior: 'cottage' }, blurb: 'A crooked hut with smoke curling from the chimney.' },
  shrine: { label: 'Shrine', inside: null, blurb: 'A weathered stone shrine, still tended by someone.' },
  'cave-mouth': { label: 'Cave mouth', inside: { underground: 'cave' }, blurb: 'A dark opening in the rock breathes cold air.' },
  'abandoned-farm': { label: 'Abandoned farm', inside: { interior: 'cottage' }, blurb: 'A farmhouse with a caved-in roof and empty fields.' },
  'ranger-lodge': { label: "Ranger's lodge", inside: { interior: 'cottage' }, sells: ['gear'], blurb: 'A sturdy log lodge with antlers over the door.' },
  ruins: { label: 'Ruins', inside: { underground: 'crypt' }, blurb: 'Broken walls, and a stair leading down into the dark.' },
  'standing-stones': { label: 'Standing stones', inside: null, blurb: 'A ring of tall, lichen-covered stones.' },
  campsite: { label: 'Old campsite', inside: null, blurb: 'A cold fire ring and flattened grass.' },
};

/** Proper name for a place of this type. */
export function poiName(rng: Rng, type: PoiType, style: NameStyle): string {
  switch (type) {
    case 'tavern':
    case 'inn':
      return signName(rng, style);
    case 'temple':
      return `Temple of ${holyName(rng, style)}`;
    case 'shrine':
      return `Shrine of ${holyName(rng, style)}`;
    case 'estate':
      return `${familyName(rng, style)} House`;
    case 'abandoned-farm':
      return `${familyName(rng, style)} Farm`;
    case 'ruins':
      return `${familyName(rng, style)} Ruins`;
    case 'cave-mouth':
      return `${familyName(rng, style)} Cave`;
    case 'standing-stones':
      return `The ${rng.pick(['Seven', 'Grey', 'Whispering', 'Crooked', 'Old', 'Weeping', 'Sleeping', 'Nine'])} Stones`;
    case 'smithy':
    case 'apothecary':
    case 'general-store': {
      const owner = personName(rng, style).split(' ')[1];
      return `${owner}'s ${POI_INFO[type].label}`;
    }
    default:
      return POI_INFO[type].label;
  }
}

// ---------------------------------------------------------------------------


/** Squares just outside a rectangle's sides (no corners), nearest the middle of each side first. */
function frontage(r: Rect): Point[] {
  const out: { p: Point; d: number }[] = [];
  const cx = r.x + (r.w - 1) / 2,
    cy = r.y + (r.h - 1) / 2;
  for (let x = r.x; x < r.x + r.w; x++) {
    out.push({ p: { x, y: r.y - 1 }, d: Math.abs(x - cx) });
    out.push({ p: { x, y: r.y + r.h }, d: Math.abs(x - cx) });
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    out.push({ p: { x: r.x - 1, y }, d: Math.abs(y - cy) });
    out.push({ p: { x: r.x + r.w, y }, d: Math.abs(y - cy) });
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.p);
}

function terrain(map: DungeonMap, p: Point): Terrain | null {
  return p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height ? null : map.terrain[idx(map, p.x, p.y)];
}

/** The street square in front of a building's door, or null if it doesn't face a street. */
function entrance(map: DungeonMap, r: Rect, ok: Terrain[] = ['road']): Point | null {
  for (const p of frontage(r)) {
    const t = terrain(map, p);
    if (t && ok.includes(t)) return p;
  }
  return null;
}

function nearWater(map: DungeonMap, r: Rect, reach: number): boolean {
  for (let y = r.y - reach; y < r.y + r.h + reach; y++)
    for (let x = r.x - reach; x < r.x + r.w + reach; x++) {
      const t = terrain(map, { x, y });
      if (t === 'water' || t === 'deepwater') return true;
    }
  return false;
}

/** How many of each kind of place a settlement gets. */
const TOWN_MIX: [PoiType, number, number][] = [
  // type, town, city
  ['tavern', 2, 4],
  ['inn', 1, 2],
  ['temple', 1, 2],
  ['smithy', 1, 2],
  ['apothecary', 1, 2],
  ['general-store', 1, 3],
  ['stables', 1, 2],
  ['barracks', 0, 1],
  ['estate', 1, 3],
  ['thieves-den', 1, 1],
];

let poiCounter = 0;
let usedNames = new Set<string>();
/** A name not used yet on this map (a few tries, then a number). */
function freshName(rng: Rng, type: PoiType, style: NameStyle): string {
  let name = poiName(rng, type, style);
  for (let k = 0; k < 8 && usedNames.has(name); k++) name = poiName(rng, type, style);
  if (usedNames.has(name)) {
    let n = 2;
    while (usedNames.has(`${name} ${n}`)) n++;
    name = `${name} ${n}`;
  }
  usedNames.add(name);
  return name;
}
const makePoi = (rng: Rng, type: PoiType, at: Point, rect: Rect | undefined, style: NameStyle, extra: Partial<PoiObject> = {}): PoiObject => ({
  id: `poi-${type}-${++poiCounter}`,
  kind: 'poi',
  poiType: type,
  name: freshName(rng, type, style),
  at,
  rect,
  description: POI_INFO[type].blurb,
  visibility: 'public',
  ...extra,
});

/** Mark the places that matter in a generated town or city. Returns the new places (also added to map.objects). */
export function placeTownPois(map: DungeonMap, seed: string, style: NameStyle = 'generic'): PoiObject[] {
  const rng = createRng(`poi:1:${seed}`);
  poiCounter = 0;
  usedNames = new Set();
  const city = map.width >= 160;
  const pois: PoiObject[] = [];
  const structures = map.objects.filter((o): o is StructureObject => o.kind === 'structure');
  const rooms = map.objects.filter((o): o is RoomObject => o.kind === 'room');
  const taken = new Set<string>();

  // Market: the market square (or the first square).
  const market = rooms.find((r) => r.label === 'Market square') ?? rooms.find((r) => r.id.startsWith('plaza'));
  if (market) {
    const c = rectCenter(market.rect);
    pois.push(makePoi(rng, 'market', c, market.rect, style, { name: market.label ?? 'Market' }));
  }

  // Gatehouses: one per gate.
  const gates = new Set<string>();
  for (const s of structures) {
    if (s.type !== 'tower' || !s.label || gates.has(s.label)) continue;
    const at = entrance(map, s.rect, ['road', 'ground']);
    if (!at) continue;
    gates.add(s.label);
    taken.add(s.id);
    pois.push(makePoi(rng, 'gatehouse', at, s.rect, style, { name: `${s.label}house` }));
  }

  // Buildings that face a street, biggest first for the grand places.
  const fronted = structures
    .filter((s) => s.type === 'building')
    .map((s) => ({ s, at: entrance(map, s.rect), area: s.rect.w * s.rect.h }))
    .filter((b): b is { s: StructureObject; at: Point; area: number } => b.at !== null);
  const byArea = [...fronted].sort((a, b) => b.area - a.area);
  const take = (b: { s: StructureObject; at: Point }, type: PoiType, extra?: Partial<PoiObject>) => {
    taken.add(b.s.id);
    pois.push(makePoi(rng, type, b.at, b.s.rect, style, extra));
  };

  // Docks on the river, if there is one.
  const dock = fronted.find((b) => !taken.has(b.s.id) && nearWater(map, b.s.rect, 2));
  if (dock) take(dock, 'docks');

  // Temples and estates get the largest houses; the rest are spread around.
  const shuffled = rng.shuffle([...fronted]);
  const plazas = rooms.filter((r) => r.id.startsWith('plaza')).map((r) => rectCenter(r.rect));
  const nearPlaza = (b: { s: StructureObject }) => {
    const c = rectCenter(b.s.rect);
    return Math.min(Infinity, ...plazas.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  };
  for (const [type, town, cityCount] of TOWN_MIX) {
    let n = city ? cityCount : town;
    const pool =
      type === 'temple' || type === 'estate' || type === 'barracks'
        ? byArea.slice(0, Math.max(12, Math.floor(byArea.length / 6)))
        : type === 'tavern' || type === 'inn'
          ? [...shuffled].sort((a, b) => nearPlaza(a) - nearPlaza(b))
          : type === 'thieves-den'
            ? [...byArea].reverse()
            : shuffled;
    for (const b of pool) {
      if (n <= 0) break;
      if (taken.has(b.s.id)) continue;
      // Keep the same trade from clustering on one street.
      if (pois.some((p) => p.poiType === type && Math.hypot(p.at.x - b.at.x, p.at.y - b.at.y) < (city ? 30 : 18))) continue;
      take(b, type, type === 'thieves-den' ? { visibility: 'dm', dmNotes: 'Looks like any run-down house from the street.' } : undefined);
      n--;
    }
  }

  map.objects = [...map.objects, ...pois];
  return pois;
}

/**
 * Turn some forest clearings into places: camps, huts, shrines, a cave. A few
 * are off the beaten path (DM-only until found).
 */
export function placeWildPois(map: DungeonMap, seed: string, style: NameStyle = 'generic'): { pois: PoiObject[]; props: FurnitureObject[] } {
  const rng = createRng(`poi:1:${seed}`);
  poiCounter = 0;
  usedNames = new Set();
  const pois: PoiObject[] = [];
  const props: FurnitureObject[] = [];
  const huts: StructureObject[] = [];
  const clearings = map.objects.filter((o): o is RoomObject => o.kind === 'room');
  const set = (p: Point, t: Terrain) => (map.terrain[idx(map, p.x, p.y)] = t);
  const free = (p: Point) => terrain(map, p) === 'ground';

  /** A small hut (walls) inside a clearing, clear of its middle, door facing the middle. */
  const hut = (room: RoomObject): { rect: Rect; at: Point } | null => {
    const c = rectCenter(room.rect);
    const spots: { rect: Rect; at: Point; d: number }[] = [];
    for (let y = room.rect.y; y + 3 <= room.rect.y + room.rect.h; y++)
      for (let x = room.rect.x; x + 3 <= room.rect.x + room.rect.w; x++) {
        const rect: Rect = { x, y, w: 3, h: 3 };
        let ok = true;
        for (let yy = y - 1; yy <= y + 3 && ok; yy++) for (let xx = x - 1; xx <= x + 3 && ok; xx++) if (!free({ x: xx, y: yy }) || (Math.abs(xx - c.x) <= 1 && Math.abs(yy - c.y) <= 1)) ok = false;
        if (!ok) continue;
        const at = { x: x + 1, y: y + 1 < c.y ? y + 3 : y - 1 };
        spots.push({ rect, at, d: Math.abs(x + 1 - c.x) + Math.abs(y + 1 - c.y) });
      }
    if (!spots.length) return null;
    // Nearest the middle without crowding it.
    spots.sort((a, b) => a.d - b.d);
    const { rect, at } = spots[0];
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) set({ x, y }, 'wall');
    return { rect, at };
  };

  // Clearings the generator already dressed become places (at most two of each kind).
  const dressedCount: Partial<Record<PoiType, number>> = {};
  for (const room of clearings) {
    const c = rectCenter(room.rect);
    const type: PoiType | null = room.label?.startsWith('Standing stones') ? 'standing-stones' : room.label?.startsWith('Ruins') ? 'ruins' : room.label?.startsWith('Old campsite') ? 'campsite' : null;
    if (!type || (dressedCount[type] ?? 0) >= 2) continue;
    dressedCount[type] = (dressedCount[type] ?? 0) + 1;
    const poi = makePoi(rng, type, c, room.rect, style);
    room.label = poi.name;
    pois.push(poi);
  }

  // Then new places in plain clearings (never the first, by the road in).
  const plain = rng.shuffle(clearings.slice(1).filter((r) => r.label?.startsWith('Clearing')));
  const wanted: PoiType[] = ['hermit-hut', 'shrine', 'cave-mouth', 'ranger-lodge', 'bandit-camp', 'abandoned-farm', 'shrine', 'bandit-camp'];
  for (const type of wanted) {
    for (let k = 0; k < plain.length; k++) {
      const room = plain[k];
      const c = rectCenter(room.rect);
      let at: Point = c;
      let rect: Rect | undefined = room.rect;
      if (type === 'hermit-hut' || type === 'abandoned-farm' || type === 'ranger-lodge') {
        const h = hut(room);
        if (!h) continue;
        at = h.at;
        rect = h.rect;
        huts.push({ id: `poi-hut-${huts.length + 1}`, kind: 'structure', type: 'building', rect: h.rect, visibility: 'public' });
      } else if (type === 'cave-mouth') {
        // A rocky outcrop with a way down at its foot.
        const spot = [
          { x: c.x, y: c.y - 2 },
          { x: c.x + 2, y: c.y },
          { x: c.x - 2, y: c.y },
          { x: c.x, y: c.y + 2 },
        ].find((p) => free(p) && free({ x: p.x, y: p.y + 1 }) && [-1, 0, 1].every((dx) => free({ x: p.x + dx, y: p.y - 1 })));
        if (!spot) continue;
        for (const dx of [-1, 0, 1]) set({ x: spot.x + dx, y: spot.y - 1 }, 'obstacle');
        set(spot, 'stairs');
        at = { x: spot.x, y: spot.y + 1 };
      } else if (type === 'bandit-camp') {
        for (const d of ORTHOGONAL) {
          const p = { x: c.x + d.x * 2, y: c.y + d.y * 2 };
          if (free(p) && rng.chance(0.7)) {
            set(p, 'furniture');
            props.push({ id: `poi-tent-${room.id}-${d.x}-${d.y}`, kind: 'furniture', type: 'stall', rect: { x: p.x, y: p.y, w: 1, h: 1 }, label: 'Tent', visibility: 'public' });
          }
        }
      }
      plain.splice(k, 1);
      const hidden = type === 'shrine' || type === 'cave-mouth' ? rng.chance(0.5) : false;
      const poi = makePoi(rng, type, at, rect, style, hidden ? { visibility: 'dm', searchDc: rng.pick([12, 13, 15]), dmNotes: 'Hidden off the trail: found with a successful search.' } : undefined);
      room.label = poi.name;
      pois.push(poi);
      break;
    }
  }
  map.objects = [...map.objects, ...props, ...huts, ...pois];
  return { pois, props };
}
