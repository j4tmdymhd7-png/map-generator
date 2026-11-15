/**
 * Name generators. Each style is a set of syllable and word tables; only the
 * generic fantasy style exists so far, but callers pass a style so regional
 * flavors can be added without touching them.
 */
import type { NameStyle } from '../model/types';
import type { Rng } from '../rng';

interface NameTables {
  /** Given-name parts: start + end. */
  starts: string[];
  ends: string[];
  /** Family names: built from two parts, or a trade name. */
  familyA: string[];
  familyB: string[];
  /** Words for place names. */
  adjectives: string[];
  nouns: string[];
  saints: string[];
}

const GENERIC: NameTables = {
  starts: ['Al', 'Bran', 'Cor', 'Da', 'Ed', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Kel', 'Lia', 'Mar', 'Nor', 'Ol', 'Per', 'Quen', 'Ros', 'Sel', 'Tam', 'Ul', 'Ves', 'Wen', 'Yor', 'Bel', 'Cael', 'Dor', 'Elo', 'Ger', 'Lor', 'Mir', 'Tess', 'Rhi', 'Ash', 'Bryn'],
  ends: ['a', 'ric', 'wen', 'dra', 'mund', 'is', 'an', 'el', 'ora', 'in', 'ett', 'ard', 'iel', 'o', 'ys', 'ine', 'old', 'yn', 'essa', 'ock', 'en', 'ia', 'ald', 'ith'],
  familyA: ['Ash', 'Black', 'Bright', 'Cold', 'Copper', 'Deep', 'Elder', 'Fair', 'Grey', 'Hollow', 'Iron', 'Long', 'Marsh', 'Oak', 'Quick', 'Red', 'Stone', 'Thorn', 'White', 'Wil'],
  familyB: ['ford', 'wood', 'brook', 'hill', 'well', 'mere', 'field', 'bridge', 'hand', 'more', 'gate', 'vale', 'ward', 'stead', 'thorne', 'barrow', 'croft', 'water'],
  adjectives: ['Gilded', 'Rusty', 'Laughing', 'Sleeping', 'Crooked', 'Silver', 'Drowned', 'Wandering', 'Jolly', 'Broken', 'Golden', 'Prancing', 'Lame', 'Merry', 'Blind', 'Weeping', 'Three-legged', 'Salty', 'Lucky', 'Green'],
  nouns: ['Goose', 'Lantern', 'Stag', 'Kettle', 'Anchor', 'Dragon', 'Fiddler', 'Boar', 'Crown', 'Hound', 'Wheel', 'Mermaid', 'Badger', 'Tankard', 'Raven', 'Pony', 'Owl', 'Barrel', 'Candle', 'Fox'],
  saints: ['the Dawn', 'the Morning Star', 'the Harvest', 'the Quiet Hand', 'the Watchful Eye', 'the Hearth', 'the Open Road', 'the Deep Well', 'the Three Moons', 'the Last Light', 'the Turning Year', 'Mercy'],
};

const STYLES: Record<NameStyle, NameTables> = { generic: GENERIC };

export const NAME_STYLE_LABEL: Record<NameStyle, string> = { generic: 'Generic fantasy' };

export function personName(rng: Rng, style: NameStyle = 'generic'): string {
  const t = STYLES[style];
  const given = rng.pick(t.starts) + rng.pick(t.ends);
  const family = rng.pick(t.familyA) + rng.pick(t.familyB);
  return `${given} ${family}`;
}

export function givenName(full: string): string {
  return full.split(' ')[0];
}

/** "The Gilded Goose" */
export function signName(rng: Rng, style: NameStyle = 'generic'): string {
  const t = STYLES[style];
  return `The ${rng.pick(t.adjectives)} ${rng.pick(t.nouns)}`;
}

/** "the Dawn" (for temples and shrines) */
export function holyName(rng: Rng, style: NameStyle = 'generic'): string {
  return rng.pick(STYLES[style].saints);
}

/** "Oakwell" (for estates and farms) */
export function familyName(rng: Rng, style: NameStyle = 'generic'): string {
  const t = STYLES[style];
  return rng.pick(t.familyA) + rng.pick(t.familyB);
}
