import { useState } from 'react';
import { lootValueGp, stackFrom, stackId } from '../core/loot/generate';
import type { ItemDef } from '../core/loot/items';
import type { ItemStack, Token } from '../core/model/types';

interface Props {
  stacks: ItemStack[];
  onChange: (stacks: ItemStack[]) => void;
  library: ItemDef[];
  /** Tokens that can receive items. */
  recipients: Token[];
  onGive: (stack: ItemStack, to: Token) => void;
  emptyText?: string;
}

const fmtGp = (v: number) => (v >= 1 ? `${Math.round(v * 100) / 100} gp` : `${Math.round(v * 100)} cp`);

/** A list of item stacks with give/remove, plus adding from the library or a quick custom item. */
export function InventoryEditor({ stacks, onChange, library, recipients, onGive, emptyText = 'Nothing here.' }: Props) {
  const [custom, setCustom] = useState({ name: '', qty: '1', value: '' });
  const add = (s: ItemStack) => onChange([...stacks, s]);
  const total = lootValueGp(stacks);

  return (
    <div className="inventory">
      {stacks.length === 0 ? (
        <p className="fine">{emptyText}</p>
      ) : (
        <ul>
          {stacks.map((s) => (
            <li key={s.id}>
              <div className="inv-line">
                <input
                  type="number"
                  min={0}
                  className="qty"
                  value={s.qty}
                  aria-label={`Quantity of ${s.name}`}
                  onChange={(e) => onChange(stacks.map((x) => (x.id === s.id ? { ...x, qty: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))}
                />
                <span className="inv-name" title={[s.description, s.dmNote && `DM: ${s.dmNote}`].filter(Boolean).join('\n')}>
                  {s.name}
                  {s.rarity && s.category === 'magic' && <em> · {s.rarity}</em>}
                  {s.category === 'quest' && <em> · quest</em>}
                </span>
                {s.valueGp !== undefined && s.valueGp > 0 && <span className="inv-value">{fmtGp(s.valueGp * s.qty)}</span>}
              </div>
              {(s.description || s.dmNote) && (
                <p className="inv-desc">
                  {s.description}
                  {s.dmNote && <span className="dm-note"> DM: {s.dmNote}</span>}
                </p>
              )}
              <div className="inv-actions">
                {recipients.length > 0 && (
                  <select
                    value=""
                    aria-label={`Give ${s.name} to`}
                    onChange={(e) => {
                      const to = recipients.find((t) => t.id === e.target.value);
                      if (to) onGive(s, to);
                    }}
                  >
                    <option value="">Give to…</option>
                    {recipients.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="link-button" onClick={() => onChange(stacks.filter((x) => x.id !== s.id))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > 0 && <p className="fine">Total value ≈ {fmtGp(total)}</p>}
      <label className="wide">
        Add from library
        <select
          value=""
          onChange={(e) => {
            const d = library.find((x) => x.id === e.target.value);
            if (d) add(stackFrom(d));
          }}
        >
          <option value="">Choose an item…</option>
          {(['quest', 'magic', 'consumable', 'gear', 'gem', 'art'] as const).map((cat) => {
            const list = library.filter((d) => d.category === cat);
            return list.length ? (
              <optgroup key={cat} label={cat[0].toUpperCase() + cat.slice(1)}>
                {list.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </label>
      <form
        className="quick-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!custom.name.trim()) return;
          add({
            id: stackId(),
            name: custom.name.trim(),
            category: 'gear',
            qty: Math.max(1, Math.round(Number(custom.qty) || 1)),
            valueGp: custom.value ? Math.max(0, Number(custom.value)) : undefined,
          });
          setCustom({ name: '', qty: '1', value: '' });
        }}
      >
        <input placeholder="Custom item" value={custom.name} aria-label="Custom item name" onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
        <input type="number" min={1} value={custom.qty} aria-label="Quantity" onChange={(e) => setCustom({ ...custom, qty: e.target.value })} />
        <input type="number" min={0} placeholder="gp" value={custom.value} aria-label="Value in gold pieces" onChange={(e) => setCustom({ ...custom, value: e.target.value })} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
