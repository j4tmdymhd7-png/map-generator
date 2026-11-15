import type { ItemDef } from '../core/loot/items';
import type { ItemStack, LootObject, Token } from '../core/model/types';
import { InventoryEditor } from './InventoryEditor';

interface Props {
  loot: LootObject;
  items: ItemDef[];
  party: Token[];
  onChange: (items: ItemStack[]) => void;
  onGive: (stack: ItemStack, to: Token) => void;
  onGiveAll: (to: Token) => void;
  onReroll: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** DM's view of a chest or pile: what's in it, and who takes what. */
export function LootPanel({ loot, items, party, onChange, onGive, onGiveAll, onReroll, onRemove, onClose }: Props) {
  return (
    <section className="loot-panel" aria-label={loot.label ?? 'Loot'}>
      <header>
        <h2>{loot.label ?? (loot.container === 'chest' ? 'Chest' : 'Loot pile')}</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </header>
      <InventoryEditor stacks={loot.items} onChange={onChange} library={items} recipients={party} onGive={onGive} emptyText="Empty." />
      <div className="row">
        {party.length > 0 && loot.items.length > 0 && (
          <select
            value=""
            aria-label="Give everything to"
            onChange={(e) => {
              const to = party.find((t) => t.id === e.target.value);
              if (to) onGiveAll(to);
            }}
          >
            <option value="">Give everything to…</option>
            {party.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={onReroll}>
          Reroll
        </button>
        <button type="button" className="danger" onClick={onRemove}>
          Remove
        </button>
      </div>
    </section>
  );
}
