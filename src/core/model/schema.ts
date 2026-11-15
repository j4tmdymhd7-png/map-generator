import { z } from 'zod';
import { ABILITIES, BEHAVIORS, FURNITURE_TYPES, ITEM_CATEGORIES, RARITIES, ROOM_SHAPES, SCHEMA_VERSION, SIZES, TERRAINS, type Campaign } from './types';

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
  z.object({ ...base, kind: z.literal('furniture'), rect, type: z.enum(FURNITURE_TYPES) }),
  z.object({ ...base, kind: z.literal('structure'), rect, type: z.enum(['building', 'wall', 'tower']) }),
  z.object({ ...base, kind: z.literal('loot'), at: point, container: z.enum(['chest', 'pile']), items: z.array(itemStackSchema) }),
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
});

export const campaignSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
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
  }),
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
  return { ok: true, campaign: res.data as Campaign };
}

export function serializeCampaign(c: Campaign): string {
  return JSON.stringify(c);
}
