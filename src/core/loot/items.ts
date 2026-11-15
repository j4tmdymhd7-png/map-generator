/**
 * The item library: everything loot can be made from. The DM can edit,
 * remove or add to all of it (quest items, lore, campaign-specific gear).
 *
 * Starter entries are generic adventuring gear and treasure with short,
 * original descriptions. Magic item names follow the SRD 5.2.1 (CC-BY-4.0);
 * descriptions here are summaries, not rules text — the DM's book governs.
 */
import type { ItemCategory, Rarity } from '../model/types';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  rarity?: Rarity;
  /** Value of one, in gold pieces. */
  valueGp?: number;
  description?: string;
  /** DM-only note: quest hooks, lore, who it belonged to. */
  dmNote?: string;
  /** Can turn up in randomly rolled loot. Off = only when the DM places it. */
  random: boolean;
  /** Appears at most once per campaign. */
  unique: boolean;
}

const g = (id: string, name: string, valueGp: number, description: string): ItemDef => ({
  id,
  name,
  category: 'gear',
  valueGp,
  description,
  random: true,
  unique: false,
});
const c = (id: string, name: string, valueGp: number, description: string): ItemDef => ({
  id,
  name,
  category: 'consumable',
  rarity: 'common',
  valueGp,
  description,
  random: true,
  unique: false,
});
const gem = (id: string, name: string, valueGp: number): ItemDef => ({ id, name, category: 'gem', valueGp, random: true, unique: false });
const art = (id: string, name: string, valueGp: number, description: string): ItemDef => ({
  id,
  name,
  category: 'art',
  valueGp,
  description,
  random: true,
  unique: false,
});
const m = (id: string, name: string, rarity: Rarity, description: string): ItemDef => ({
  id,
  name,
  category: 'magic',
  rarity,
  description,
  random: true,
  unique: false,
});

export const STARTER_ITEMS: ItemDef[] = [
  // Adventuring gear
  g('rope', 'Hempen rope (50 ft)', 1, 'Sturdy, a little frayed at one end.'),
  g('lantern', 'Hooded lantern', 5, 'Dented brass; still has oil in it.'),
  g('torches', 'Bundle of torches', 1, 'Five pitch-soaked torches tied with twine.'),
  g('crowbar', 'Crowbar', 2, 'Good for doors that won’t cooperate.'),
  g('rations', 'Trail rations (5 days)', 3, 'Hard bread, dried meat, a wedge of cheese.'),
  g('bedroll', 'Bedroll', 1, 'Smells faintly of campfire.'),
  g('caltrops', 'Bag of caltrops', 1, 'Spiky iron scatter for slowing pursuers.'),
  g('tinderbox', 'Tinderbox', 1, 'Flint, steel and dry tinder in a tin.'),
  g('thieves-tools', 'Thieves’ tools', 25, 'A leather roll of picks and files.'),
  g('healers-kit', 'Healer’s kit', 5, 'Bandages, salves and splints.'),
  g('chain', 'Iron chain (10 ft)', 5, 'Heavy links; one end has a manacle.'),
  g('map-fragment', 'Torn map fragment', 0, 'Part of a hand-drawn map. The rest is missing.'),
  // Consumables
  c('potion-healing', 'Potion of Healing', 50, 'Red liquid that restores some hit points when drunk.'),
  c('antitoxin', 'Antitoxin', 50, 'A bitter draught that helps against poison for a while.'),
  c('alchemist-fire', 'Alchemist’s fire', 50, 'A flask that bursts into flame when thrown.'),
  c('holy-water', 'Flask of holy water', 25, 'Blessed water, harmful to fiends and the undead.'),
  { ...c('potion-greater-healing', 'Potion of Greater Healing', 250, 'Restores more hit points than a standard potion.'), rarity: 'uncommon' },
  { ...c('spell-scroll-1', 'Spell scroll (1st level)', 100, 'A single spell, written out and ready to read.'), rarity: 'common' },
  // Gems
  gem('agate', 'Banded agate', 10),
  gem('quartz', 'Clear quartz', 10),
  gem('garnet', 'Garnet', 100),
  gem('amethyst', 'Amethyst', 100),
  gem('pearl', 'Pearl', 100),
  gem('topaz', 'Golden topaz', 500),
  gem('emerald', 'Emerald', 1000),
  gem('sapphire', 'Star sapphire', 1000),
  gem('diamond', 'Diamond', 5000),
  // Art objects
  art('dice', 'Carved bone dice', 25, 'A pair, worn smooth by many hands.'),
  art('locket', 'Silver locket', 25, 'Holds a faded portrait of a stranger.'),
  art('goblet', 'Gilded goblet', 250, 'Gold leaf over pewter, engraved with vines.'),
  art('tapestry', 'Small silk tapestry', 250, 'A hunting scene in deep blues and greens.'),
  art('idol', 'Jade idol', 750, 'A squat, grinning figure the size of a fist.'),
  art('crown', 'Jeweled circlet', 2500, 'Thin gold set with small rubies.'),
  art('painting', 'Masterwork painting', 7500, 'An old portrait in a heavy gilt frame.'),
  // Magic items
  m('potion-climbing', 'Potion of Climbing', 'common', 'For a while, you climb as easily as you walk.'),
  m('bag-holding', 'Bag of Holding', 'uncommon', 'A bag far larger inside than out.'),
  m('cloak-protection', 'Cloak of Protection', 'uncommon', 'Grants a small bonus to AC and saving throws while worn.'),
  m('boots-elvenkind', 'Boots of Elvenkind', 'uncommon', 'Your footsteps make no sound.'),
  m('weapon-1', '+1 Weapon', 'uncommon', 'A weapon with a +1 bonus to attack and damage rolls.'),
  m('wand-mm', 'Wand of Magic Missiles', 'uncommon', 'Fires darts of force; recharges each dawn.'),
  m('goggles-night', 'Goggles of Night', 'uncommon', 'Let the wearer see in the dark.'),
  m('ring-protection', 'Ring of Protection', 'rare', 'A small bonus to AC and saving throws.'),
  m('flame-tongue', 'Flame Tongue', 'rare', 'A sword that can burst into flame on command.'),
  m('weapon-2', '+2 Weapon', 'rare', 'A weapon with a +2 bonus to attack and damage rolls.'),
  m('cloak-displacement', 'Cloak of Displacement', 'rare', 'Makes you appear to stand a little to one side of where you are.'),
  m('staff-striking', 'Staff of Striking', 'very rare', 'A staff that channels force into its blows.'),
  m('weapon-3', '+3 Weapon', 'very rare', 'A weapon with a +3 bonus to attack and damage rolls.'),
  m('manual-gainful', 'Manual of Gainful Exercise', 'very rare', 'A book of training that permanently raises Strength.'),
  m('vorpal', 'Vorpal Sword', 'legendary', 'A blade of terrible sharpness.'),
  m('ring-three-wishes', 'Ring of Three Wishes', 'legendary', 'Holds a small number of powerful wishes.'),
];

/** Pocket change and hoard money are generated directly, not from the library. */
export const COIN_TYPES = [
  { key: 'cp', name: 'Copper pieces', valueGp: 0.01 },
  { key: 'sp', name: 'Silver pieces', valueGp: 0.1 },
  { key: 'gp', name: 'Gold pieces', valueGp: 1 },
  { key: 'pp', name: 'Platinum pieces', valueGp: 10 },
] as const;
