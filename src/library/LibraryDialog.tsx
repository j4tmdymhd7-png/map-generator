import { useEffect, useRef, useState } from 'react';
import type { CreatureTemplate } from '../core/library/creatures';
import type { ItemDef } from '../core/loot/items';
import { ABILITIES, BEHAVIORS, ITEM_CATEGORIES, RARITIES, SIZES, type Behavior, type ItemCategory, type Rarity, type Size } from '../core/model/types';
import { ABILITY_LABEL, abilityMod, formatMod } from '../core/stats';
import type { Library } from './useLibrary';

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const n = (v: string, f = 0) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : f);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function blankCreature(): CreatureTemplate {
  return {
    id: newId('cr'),
    name: 'New creature',
    size: 'medium',
    speed: 30,
    stats: { ac: 12, hp: 10, maxHp: 10, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    behavior: 'wander',
    encounters: false,
    groupMin: 1,
    groupMax: 1,
    weight: 1,
    carriesLoot: false,
  };
}

function blankItem(): ItemDef {
  return { id: newId('it'), name: 'New item', category: 'quest', random: false, unique: true };
}

function CreatureForm({ c, onSave, onDelete }: { c: CreatureTemplate; onSave: (c: CreatureTemplate) => void; onDelete: () => void }) {
  const [d, setD] = useState(c);
  const st = d.stats;
  return (
    <form
      className="lib-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...d, stats: { ...st, hp: st.maxHp } });
      }}
    >
      <label className="wide">
        Name
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <label>
        Size
        <select value={d.size} onChange={(e) => setD({ ...d, size: e.target.value as Size })}>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Speed (ft)
        <input type="number" step={5} min={0} value={d.speed} onChange={(e) => setD({ ...d, speed: n(e.target.value, 30) })} />
      </label>
      <label>
        AC
        <input type="number" value={st.ac} onChange={(e) => setD({ ...d, stats: { ...st, ac: n(e.target.value, 10) } })} />
      </label>
      <label>
        Hit points
        <input type="number" min={1} value={st.maxHp} onChange={(e) => setD({ ...d, stats: { ...st, maxHp: Math.max(1, n(e.target.value, 1)) } })} />
      </label>
      <label>
        CR
        <input value={st.cr ?? ''} onChange={(e) => setD({ ...d, stats: { ...st, cr: e.target.value || undefined } })} />
      </label>
      <label>
        Initiative bonus
        <input
          type="number"
          placeholder={formatMod(abilityMod(st.abilities.dex))}
          value={d.initiativeBonus ?? ''}
          onChange={(e) => setD({ ...d, initiativeBonus: e.target.value === '' ? undefined : n(e.target.value) })}
        />
      </label>
      <div className="abilities wide">
        {ABILITIES.map((a) => (
          <label key={a}>
            <span>{ABILITY_LABEL[a]}</span>
            <input
              type="number"
              min={1}
              max={30}
              value={st.abilities[a]}
              onChange={(e) => setD({ ...d, stats: { ...st, abilities: { ...st.abilities, [a]: Math.min(30, Math.max(1, n(e.target.value, 10))) } } })}
            />
            <small>{formatMod(abilityMod(st.abilities[a]))}</small>
          </label>
        ))}
      </div>
      <label className="wide">
        Actions &amp; traits
        <textarea rows={4} value={st.actions ?? ''} onChange={(e) => setD({ ...d, stats: { ...st, actions: e.target.value || undefined } })} />
      </label>
      <label>
        When unseen
        <select value={d.behavior} onChange={(e) => setD({ ...d, behavior: e.target.value as Behavior })}>
          {BEHAVIORS.map((b) => (
            <option key={b} value={b}>
              {{ wander: 'Wanders', guard: 'Guards an area', still: 'Stays put' }[b]}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={d.carriesLoot} onChange={(e) => setD({ ...d, carriesLoot: e.target.checked })} /> Carries loot
      </label>
      <fieldset className="wide">
        <legend>Random encounters</legend>
        <label className="check">
          <input type="checkbox" checked={d.encounters} onChange={(e) => setD({ ...d, encounters: e.target.checked })} /> Can appear
        </label>
        <label>
          Group size
          <span className="range">
            <input type="number" min={1} value={d.groupMin} aria-label="Minimum group size" onChange={(e) => setD({ ...d, groupMin: Math.max(1, n(e.target.value, 1)) })} />
            to
            <input type="number" min={1} value={d.groupMax} aria-label="Maximum group size" onChange={(e) => setD({ ...d, groupMax: Math.max(1, n(e.target.value, 1)) })} />
          </span>
        </label>
        <label>
          How common
          <input type="number" min={0} value={d.weight} onChange={(e) => setD({ ...d, weight: Math.max(0, n(e.target.value, 1)) })} />
        </label>
      </fieldset>
      <div className="row wide">
        <button type="submit" className="primary">
          Save creature
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </form>
  );
}

function ItemForm({ item, onSave, onDelete }: { item: ItemDef; onSave: (i: ItemDef) => void; onDelete: () => void }) {
  const [d, setD] = useState(item);
  return (
    <form
      className="lib-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <label className="wide">
        Name
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <label>
        Type
        <select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as ItemCategory })}>
          {ITEM_CATEGORIES.filter((c) => c !== 'coins').map((c) => (
            <option key={c} value={c}>
              {cap(c)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Rarity
        <select value={d.rarity ?? ''} onChange={(e) => setD({ ...d, rarity: (e.target.value || undefined) as Rarity | undefined })}>
          <option value="">—</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {cap(r)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value (gp)
        <input type="number" min={0} value={d.valueGp ?? ''} onChange={(e) => setD({ ...d, valueGp: e.target.value === '' ? undefined : Math.max(0, n(e.target.value)) })} />
      </label>
      <label className="wide">
        Description (what players learn)
        <textarea rows={3} value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value || undefined })} />
      </label>
      <label className="wide">
        DM note (quest hooks, lore, origin)
        <textarea rows={3} value={d.dmNote ?? ''} onChange={(e) => setD({ ...d, dmNote: e.target.value || undefined })} />
      </label>
      <label className="check wide">
        <input type="checkbox" checked={d.random} onChange={(e) => setD({ ...d, random: e.target.checked })} /> Can turn up in random loot (off = only when I place it)
      </label>
      <label className="check wide">
        <input type="checkbox" checked={d.unique} onChange={(e) => setD({ ...d, unique: e.target.checked })} /> Unique: appears at most once per campaign
      </label>
      <div className="row wide">
        <button type="submit" className="primary">
          Save item
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </form>
  );
}

/** Modal editor for the creature and item libraries. Changes save in this browser. */
export function LibraryDialog({ lib, onClose }: { lib: Library; onClose: () => void }) {
  const [tab, setTab] = useState<'creatures' | 'items'>('items');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreatureTemplate | ItemDef | null>(null);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const list = tab === 'creatures' ? lib.creatures : lib.items;
  const shown = list.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase()));
  const current = draft ?? list.find((x) => x.id === editing) ?? null;

  return (
    <dialog ref={ref} className="library" onClose={onClose} aria-label="Library">
      <header>
        <h2>Library</h2>
        <div role="tablist" className="tabs">
          {(['items', 'creatures'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setEditing(null);
                setDraft(null);
              }}
            >
              {t === 'items' ? `Items (${lib.items.length})` : `Creatures (${lib.creatures.length})`}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close library">
          Close
        </button>
      </header>
      <div className="lib-body">
        <div className="lib-list">
          <div className="row">
            <input placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search library" />
            <button
              type="button"
              onClick={() => {
                setDraft(tab === 'creatures' ? blankCreature() : blankItem());
                setEditing(null);
              }}
            >
              + New
            </button>
          </div>
          <ul>
            {shown.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className={current?.id === x.id ? 'lib-item on' : 'lib-item'}
                  onClick={() => {
                    setEditing(x.id);
                    setDraft(null);
                  }}
                >
                  <span>{x.name}</span>
                  <small>
                    {'category' in x
                      ? `${cap(x.category)}${x.rarity ? ` · ${x.rarity}` : ''}${x.random ? '' : ' · DM-placed'}${x.unique ? ' · unique' : ''}`
                      : `${cap(x.size)} · CR ${x.stats.cr ?? '?'}${x.encounters ? ' · encounters' : ''}`}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="link-button"
            onClick={() => (tab === 'creatures' ? lib.resetCreatures() : lib.resetItems())}
            title="Replace this list with the starter set"
          >
            Reset {tab} to starter set
          </button>
        </div>
        <div className="lib-detail">
          {!current ? (
            <p className="fine">
              {tab === 'items'
                ? 'Pick an item to edit, or add a new one: quest items, lore, campaign-specific gear. Items saved here can be added to any chest or inventory.'
                : 'Pick a creature to edit, or add your own. Creatures marked for random encounters can turn up when you roll one.'}
            </p>
          ) : 'category' in current ? (
            <ItemForm
              key={current.id}
              item={current}
              onSave={(i) => {
                lib.saveItem(i);
                setDraft(null);
                setEditing(i.id);
              }}
              onDelete={() => {
                lib.removeItem(current.id);
                setDraft(null);
                setEditing(null);
              }}
            />
          ) : (
            <CreatureForm
              key={current.id}
              c={current}
              onSave={(c) => {
                lib.saveCreature(c);
                setDraft(null);
                setEditing(c.id);
              }}
              onDelete={() => {
                lib.removeCreature(current.id);
                setDraft(null);
                setEditing(null);
              }}
            />
          )}
        </div>
      </div>
      <footer className="fine">Your library is saved in this browser. Starter magic items use SRD 5.2.1 names (CC-BY-4.0); descriptions are short summaries.</footer>
    </dialog>
  );
}
