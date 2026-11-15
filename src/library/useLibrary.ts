import { useCallback, useEffect, useState } from 'react';
import { STARTER_CREATURES, type CreatureTemplate } from '../core/library/creatures';
import { STARTER_ITEMS, type ItemDef } from '../core/loot/items';

const KEYS = { creatures: 'dmg.library.creatures.v1', items: 'dmg.library.items.v1', used: 'dmg.library.usedUniques.v1' };

/** Read JSON from localStorage, falling back when storage is missing, blocked or corrupt. */
function load<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the library still works for this session.
  }
}

const isArrayOf = (field: string) => (v: unknown) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && field in x);

export interface Library {
  creatures: CreatureTemplate[];
  items: ItemDef[];
  /** Unique items already handed out this campaign. */
  usedUniques: Set<string>;
  saveCreature: (c: CreatureTemplate) => void;
  removeCreature: (id: string) => void;
  saveItem: (i: ItemDef) => void;
  removeItem: (id: string) => void;
  markUsed: (ids: string[]) => void;
  resetCreatures: () => void;
  resetItems: () => void;
}

export function useLibrary(): Library {
  const [creatures, setCreatures] = useState<CreatureTemplate[]>(() => load(KEYS.creatures, STARTER_CREATURES, isArrayOf('stats')));
  const [items, setItems] = useState<ItemDef[]>(() => load(KEYS.items, STARTER_ITEMS, isArrayOf('category')));
  const [used, setUsed] = useState<string[]>(() => load(KEYS.used, [] as string[], (v) => Array.isArray(v)));

  useEffect(() => save(KEYS.creatures, creatures), [creatures]);
  useEffect(() => save(KEYS.items, items), [items]);
  useEffect(() => save(KEYS.used, used), [used]);

  const upsert = <T extends { id: string }>(list: T[], x: T) => (list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x]);

  return {
    creatures,
    items,
    usedUniques: new Set(used),
    saveCreature: useCallback((c) => setCreatures((l) => upsert(l, c)), []),
    removeCreature: useCallback((id) => setCreatures((l) => l.filter((c) => c.id !== id)), []),
    saveItem: useCallback((i) => setItems((l) => upsert(l, i)), []),
    removeItem: useCallback((id) => setItems((l) => l.filter((i) => i.id !== id)), []),
    markUsed: useCallback((ids) => setUsed((u) => [...new Set([...u, ...ids])]), []),
    resetCreatures: useCallback(() => setCreatures(STARTER_CREATURES), []),
    resetItems: useCallback(() => {
      setItems(STARTER_ITEMS);
      setUsed([]);
    }, []),
  };
}
