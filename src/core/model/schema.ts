import { z } from 'zod';
import { ABILITIES, ATTITUDES, BEHAVIORS, FURNITURE_TYPES, ITEM_CATEGORIES, NAME_STYLES, POI_TYPES, RARITIES, ROOM_SHAPES, SCHEMA_VERSION, SIZES, TERRAINS, type Campaign } from './types';

const point = z.object({ x: z.number().int(), y: z.number().int() });
const rect = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
const visibility = z.enum(['public', 'dm']);
const base = { id: z.string().min(1), visibility, label: z.string().optional() };

export const itemStackSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: z.enum(ITEM_CATEGORIES),
  qty: z.number().int().nonnegative(),
  valueGp: z.number().nonnegative().optional(),
  rarity: z.enum(RARITIES).optional(),
  description: z.string().optional(),
  dmNote: z.string().optional(),
  defId: z.string().optional(),
});

const mapObject = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('room'), rect, shape: z.enum(ROOM_SHAPES).optional() }),
  z.object({ ...base, kind: z.literal('corridor'), cells: z.array(point) }),
  z.object({ ...base, kind: z.literal('door'), at: point, state: z.enum(['open', 'closed', 'locked']) }),
  z.object({
    ...base,
    kind: z.literal('stairs'),
    at: point,
    role: z.enum(['entrance', 'exit']).optional(),
    linkTo: z.object({ mapId: z.string(), objectId: z.string() }).optional(),
  }),
  z.object({ ...base, kind: z.literal('note'), at: point, text: z.string() }),
  z.object({ ...base, kind: z.literal('furniture'), rect, type: z.enum(FURNITURE_TYPES), facing: z.enum(['north', 'east', 'south', 'west']).optional() }),
  z.object({ ...base, kind: z.literal('structure'), rect, type: z.enum(['building', 'wall', 'tower']) }),
  z.object({ ...base, kind: z.literal('loot'), at: point, container: z.enum(['chest', 'pile']), items: z.array(itemStackSchema) }),
  z.object({
    ...base,
    kind: z.literal('poi'),
    poiType: z.enum(POI_TYPES),
    name: z.string(),
    at: point,
    rect: rect.optional(),
    description: z.string().optional(),
    dmNotes: z.string().optional(),
    searchDc: z.number().int().optional(),
    link: z.object({ mapId: z.string() }).optional(),
  }),
]);

const dungeonMap = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    width: z.number().int().min(1).max(500),
    height: z.number().int().min(1).max(500),
    cellSizeFeet: z.number().positive(),
    terrain: z.array(z.enum(TERRAINS)),
    flags: z.array(z.number().int().nonnegative()),
    objects: z.array(mapObject),
    generation: z
      .object({
        seed: z.string(),
        generatorVersion: z.number().int(),
        params: z.record(z.string(), z.unknown()),
      })
      .optional(),
    style: z.enum(['dungeon', 'interior', 'outdoor']).optional(),
    spawn: point.optional(),
    parent: z.object({ mapId: z.string(), poiId: z.string() }).optional(),
    recipe: z.object({ size: z.string(), kind: z.string() }).optional(),
  })
  .superRefine((m, ctx) => {
    const n = m.width * m.height;
    if (m.terrain.length !== n) ctx.addIssue({ code: 'custom', message: `terrain has ${m.terrain.length} cells, expected ${n}` });
    if (m.flags.length !== n) ctx.addIssue({ code: 'custom', message: `flags has ${m.flags.length} cells, expected ${n}` });
  });

const speed = z.number().nonnegative();
const token = z.object({
  id: z.string().min(1),
  mapId: z.string().min(1),
  label: z.string(),
  color: z.string(),
  image: z.string().optional(),
  size: z.enum(SIZES),
  position: point,
  speeds: z.object({
    walk: speed,
    climb: speed.optional(),
    swim: speed.optional(),
    fly: speed.optional(),
    burrow: speed.optional(),
  }),
  senses: z.object({
    darkvision: speed.optional(),
    blindsight: speed.optional(),
    tremorsense: speed.optional(),
    truesight: speed.optional(),
  }),
  side: z.enum(['party', 'enemy', 'neutral']),
  conditions: z.array(z.string()),
  visibility,
  initiativeBonus: z.number().int().optional(),
  behavior: z.enum(BEHAVIORS).optional(),
  home: point.optional(),
  leash: z.number().int().nonnegative().optional(),
  stats: z
    .object({
      ac: z.number().int(),
      hp: z.number().int(),
      maxHp: z.number().int().nonnegative(),
      tempHp: z.number().int().nonnegative().optional(),
      abilities: z.object(Object.fromEntries(ABILITIES.map((a) => [a, z.number().int().min(1).max(30)])) as Record<(typeof ABILITIES)[number], z.ZodNumber>),
      cr: z.string().optional(),
      actions: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  inventory: z.array(itemStackSchema).optional(),
  templateId: z.string().optional(),
  npcId: z.string().optional(),
});

export const npcSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  occupation: z.string(),
  descriptor: z.string(),
  known: z.boolean(),
  attitude: z.enum(ATTITUDES),
  appearance: z.string(),
  mannerism: z.string(),
  want: z.string(),
  secret: z.string(),
  rumors: z.array(z.string()),
  notes: z.string().optional(),
  mapId: z.string().optional(),
  workPoiId: z.string().optional(),
  homePoiId: z.string().optional(),
  shop: z.array(z.string()).optional(),
  schedule: z.array(z.object({ at: z.number().int(), poiId: z.string() })).optional(),
});

export const campaignSchema = z.object({
  // Version 1 files have the same shape minus the optional fields below.
  schemaVersion: z.union([z.literal(1), z.literal(SCHEMA_VERSION)]),
  id: z.string().min(1),
  name: z.string(),
  ruleset: z.object({ edition: z.literal('dnd-2024'), version: z.literal('srd-5.2.1') }),
  maps: z.array(dungeonMap),
  tokens: z.array(token),
  settings: z.object({
    grid: z.object({
      diagonal: z.enum(['uniform', 'alternating']),
      closedDoors: z.enum(['block', 'passable']),
    }),
    partyLevel: z.number().int().min(1).max(20).optional(),
    nameStyle: z.enum(NAME_STYLES).optional(),
  }),
  activeMapId: z.string().optional(),
  fog: z.record(z.string(), z.string()).optional(),
  npcs: z.array(npcSchema).optional(),
  clock: z.object({ day: z.number().int().min(1), minute: z.number().int().min(0).max(1439) }).optional(),
  updatedAt: z.string().optional(),
});

export type ParseResult = { ok: true; campaign: Campaign } | { ok: false; errors: string[] };

/**
 * Validate untrusted JSON (imports, saved files). Never throws; callers keep
 * their last good save when this fails.
 */
export function parseCampaign(input: unknown): ParseResult {
  const res = campaignSchema.safeParse(input);
  if (!res.success) {
    return {
      ok: false,
      errors: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  // Upgrade older files to the current version.
  return { ok: true, campaign: { ...(res.data as Omit<Campaign, 'schemaVersion'>), schemaVersion: SCHEMA_VERSION } };
}

export function serializeCampaign(c: Campaign): string {
  return JSON.stringify(c);
}

/**
 * Fog memory as text: one character per run of squares, '0' hidden / '1'
 * explored, written as `<state><length>` pairs ("0120,134,0900"). Visible
 * squares are stored as explored; sight is recomputed on load.
 */
export function encodeFog(fog: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  while (i < fog.length) {
    const v = fog[i] ? 1 : 0;
    let j = i;
    while (j < fog.length && (fog[j] ? 1 : 0) === v) j++;
    out.push(`${v}${j - i}`);
    i = j;
  }
  return out.join(',');
}

/** Inverse of encodeFog. Returns null if the text doesn't fit a map of `length` squares. */
export function decodeFog(text: string, length: number): Uint8Array | null {
  const out = new Uint8Array(length);
  let i = 0;
  for (const run of text.split(',')) {
    if (!run) continue;
    const v = run[0] === '1' ? 1 : 0;
    const n = Number(run.slice(1));
    if (!Number.isInteger(n) || n < 0 || i + n > length) return null;
    out.fill(v, i, i + n);
    i += n;
  }
  return i === length ? out : null;
}
