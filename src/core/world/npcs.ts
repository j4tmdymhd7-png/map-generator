/**
 * Notable NPCs: generated reference cards for the people who run the places
 * on a map. Everything here is a starting point the DM edits.
 */
import type { Attitude, NameStyle, Npc, PoiObject, PoiType } from '../model/types';
import type { ItemDef } from '../loot/items';
import { createRng, type Rng } from '../rng';
import { personName } from './names';
import { POI_INFO } from './poi';

/** Who works at each kind of place: [occupation, descriptor players see]. Proprietor first. */
const STAFF: Partial<Record<PoiType, [string, string][]>> = {
  tavern: [
    ['Tavern keeper', 'Tavern keeper'],
    ['Server', 'Harried server'],
    ['Regular', 'Regular at the bar'],
  ],
  inn: [
    ['Innkeeper', 'Innkeeper'],
    ['Stable hand', 'Stable hand'],
  ],
  temple: [
    ['High priest', 'Robed priest'],
    ['Acolyte', 'Young acolyte'],
  ],
  smithy: [
    ['Blacksmith', 'Soot-streaked smith'],
    ['Apprentice', "Smith's apprentice"],
  ],
  market: [
    ['Market warden', 'Market warden'],
    ['Stallholder', 'Loud stallholder'],
    ['Peddler', 'Peddler with a pack'],
  ],
  barracks: [
    ['Watch captain', 'Watch captain'],
    ['Sergeant', 'Gruff sergeant'],
  ],
  gatehouse: [['Gate sergeant', 'Guard at the gate']],
  estate: [
    ['Noble', 'Finely dressed noble'],
    ['Steward', 'Steward of the house'],
  ],
  'thieves-den': [
    ['Guild fence', 'Watchful fence'],
    ['Cutpurse', 'Sharp-eyed youth'],
  ],
  docks: [
    ['Harbormaster', 'Harbormaster'],
    ['Dockhand', 'Dockhand'],
  ],
  apothecary: [['Apothecary', 'Herb-stained apothecary']],
  stables: [['Stablemaster', 'Stablemaster']],
  'general-store': [['Shopkeeper', 'Shopkeeper']],
  'bandit-camp': [['Bandit chief', 'Scarred bandit leader']],
  'hermit-hut': [['Hermit', 'Wild-haired hermit']],
  shrine: [['Shrine keeper', 'Quiet pilgrim']],
  'abandoned-farm': [['Squatter', 'Wary squatter']],
  'ranger-lodge': [['Ranger', 'Weathered ranger']],
};

const APPEARANCE = [
  'Tall and stooped, with ink-stained fingers',
  'Short and broad, with a braided beard',
  'Missing two fingers on the left hand',
  'Freckled, with a crooked grin',
  'Wears far too much jewelry',
  'Shaved head and a faded tattoo on the neck',
  'Immaculately dressed, not a hair out of place',
  'Weather-beaten face and a squint',
  'Spectacles pushed up on the forehead',
  'A burn scar across one cheek',
  'Very old, but moves quickly',
  'Heavily pregnant and unbothered by it',
  'Thin as a rake, with a hacking cough',
  'Booming voice and a barrel chest',
  'Patched clothes, mended with care',
  'Always smells faintly of smoke',
];
const MANNERISM = [
  'Answers questions with questions',
  'Hums while thinking',
  'Never meets anyone’s eyes',
  'Laughs at their own jokes',
  'Speaks very slowly and precisely',
  'Calls everyone “friend”',
  'Taps the table while talking',
  'Whispers, even when there’s no need',
  'Quotes old proverbs, often wrongly',
  'Interrupts constantly',
  'Counts coins while talking',
  'Polite to a fault, and a little cold',
];
const WANT = [
  'To pay off a debt before the end of the month',
  'Revenge on a business rival',
  'News of a missing brother',
  'To leave town and start over',
  'Respect from the town council',
  'A rare ingredient from the wilds',
  'Someone to clear out the cellar',
  'To keep the watch out of their affairs',
  'A good match for their child',
  'To find out who has been stealing from them',
  'Proof that a neighbor is lying',
  'A quiet life, and nothing more',
];
const SECRET = [
  'Owes money to the thieves’ guild',
  'Is not who they claim to be',
  'Saw something on the night of the fire',
  'Waters down everything they sell',
  'Hides a fugitive in the back room',
  'Was once an adventurer, and ran',
  'Reports to someone in the watch',
  'Has a map they can’t read',
  'Is losing their sight',
  'Is secretly very rich',
  'Has a second family in another town',
  'Has nothing to hide (and is offended you ask)',
];
const RUMORS = [
  'Lights have been seen in the old ruins at night.',
  'A merchant caravan never arrived last week.',
  'The watch captain takes bribes, they say.',
  'Something has been killing sheep on the outlying farms.',
  'A stranger has been asking about the party by name.',
  'The temple’s relic is a fake; the real one was sold.',
  'Wolves are bolder this year. Bigger, too.',
  'There’s a cave in the hills where the air never warms.',
  'A noble family is hiring quietly, and paying well.',
  'Someone broke into the smithy and took nothing but a key.',
  'The well in the square tastes of iron lately.',
  'A hermit in the woods knows the old roads.',
];

let npcCounter = 0;
export function newNpcId(): string {
  return `npc-${Date.now().toString(36)}-${++npcCounter}`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function generateNpc(rng: Rng, occupation: string, descriptor: string, style: NameStyle, attitude: Attitude = 'indifferent'): Npc {
  return {
    id: newNpcId(),
    name: personName(rng, style),
    occupation,
    descriptor,
    known: false,
    attitude,
    appearance: rng.pick(APPEARANCE),
    mannerism: rng.pick(MANNERISM),
    want: rng.pick(WANT),
    secret: rng.pick(SECRET),
    rumors: rng.chance(0.7) ? [rng.pick(RUMORS)] : [],
  };
}

/** What a merchant sells: random-loot-eligible library items in the place's categories, cheapest kinds first. */
export function shopStock(rng: Rng, type: PoiType, items: ItemDef[]): string[] | undefined {
  const sells = POI_INFO[type].sells;
  if (!sells) return undefined;
  const pool = items.filter((i) => sells.includes(i.category as 'gear') && i.random && !i.unique && (i.rarity === undefined || i.rarity === 'common' || i.rarity === 'uncommon'));
  return rng
    .shuffle([...pool])
    .slice(0, Math.min(pool.length, rng.int(4, 8)))
    .map((i) => i.id);
}

/** People for each place on a map. Proprietors always; other staff some of the time. */
export function populatePois(mapId: string, pois: PoiObject[], seed: string, style: NameStyle, items: ItemDef[]): Npc[] {
  const rng = createRng(`npcs:1:${seed}`);
  const out: Npc[] = [];
  for (const poi of pois) {
    const staff = STAFF[poi.poiType];
    if (!staff) continue;
    staff.forEach(([occupation, descriptor], k) => {
      if (k > 0 && !rng.chance(0.55)) return;
      const attitude: Attitude = poi.poiType === 'bandit-camp' ? 'hostile' : poi.poiType === 'thieves-den' || poi.poiType === 'gatehouse' ? 'indifferent' : rng.chance(0.3) ? 'friendly' : 'indifferent';
      const npc = generateNpc(rng, occupation, descriptor, style, attitude);
      npc.mapId = mapId;
      npc.workPoiId = poi.id;
      if (k === 0) {
        npc.shop = shopStock(rng, poi.poiType, items);
        npc.notes = `Runs ${poi.name}.`;
      } else npc.notes = `${occupation} at ${poi.name}.`;
      if (npc.rumors.length === 0 && k === 0) npc.rumors = [rng.pick(RUMORS)];
      out.push(npc);
    });
  }
  return out;
}

/** A one-line summary for lists: "Brannoc Ashford, blacksmith (friendly)". */
export function npcSummary(n: Npc): string {
  return `${n.name}, ${lower(n.occupation)} (${n.attitude})`;
}

/** What the players know of an NPC: their name once introduced, otherwise how they look. */
export function npcDisplayName(n: Npc): string {
  return n.known ? n.name : n.descriptor;
}
