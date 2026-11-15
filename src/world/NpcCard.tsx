import type { ItemDef } from '../core/loot/items';
import { ATTITUDES, type Attitude, type Npc, type Token } from '../core/model/types';
import { npcDisplayName } from '../core/world/npcs';

const ATTITUDE_LABEL: Record<Attitude, string> = { friendly: 'Friendly', indifferent: 'Indifferent', hostile: 'Hostile' };

interface Props {
  npc: Npc;
  playerView: boolean;
  /** Item library, for the names and prices of what they sell. */
  items: ItemDef[];
  party: Token[];
  /** Where they work, for display. */
  placeName?: string;
  onChange: (patch: Partial<Npc>) => void;
  onSell?: (item: ItemDef, to: Token) => void;
  /** Put a token for them on the current map (shown when they have none here). */
  onPlace?: () => void;
  onDelete?: () => void;
  onClose?: () => void;
}

/**
 * An NPC reference card. The DM sees and edits everything; Player view shows
 * only the name (once introduced), role and appearance.
 */
export function NpcCard({ npc, playerView, items, party, placeName, onChange, onSell, onPlace, onDelete, onClose }: Props) {
  if (playerView) {
    return (
      <section className="npc-card" aria-label={npcDisplayName(npc)}>
        <header>
          <h2>{npcDisplayName(npc)}</h2>
          {onClose && (
            <button type="button" className="link-button" onClick={onClose}>
              Close
            </button>
          )}
        </header>
        {npc.known && <p className="fine">{npc.occupation}</p>}
        <p>{npc.appearance}</p>
      </section>
    );
  }
  const stock = (npc.shop ?? []).map((id) => items.find((i) => i.id === id)).filter((i): i is ItemDef => !!i);
  const text = (field: 'name' | 'occupation' | 'descriptor' | 'appearance' | 'mannerism' | 'want' | 'secret', label: string, area = false) => (
    <label className={area ? 'wide' : undefined}>
      {label}
      {area ? (
        <textarea rows={2} value={npc[field]} onChange={(e) => onChange({ [field]: e.target.value })} />
      ) : (
        <input value={npc[field]} onChange={(e) => onChange({ [field]: e.target.value })} />
      )}
    </label>
  );
  return (
    <section className="npc-card" aria-label={`NPC: ${npc.name}`}>
      <header>
        <h2>{npc.name}</h2>
        {onClose && (
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      <p className="fine">
        {npc.occupation}
        {placeName ? ` · ${placeName}` : ''} · players see: <strong>{npcDisplayName(npc)}</strong>
      </p>
      <div className="npc-fields">
        {text('name', 'Name')}
        {text('occupation', 'Occupation')}
        {text('descriptor', 'Before introductions')}
        <label>
          Attitude
          <select value={npc.attitude} onChange={(e) => onChange({ attitude: e.target.value as Attitude })}>
            {ATTITUDES.map((a) => (
              <option key={a} value={a}>
                {ATTITUDE_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="check wide">
          <input type="checkbox" checked={npc.known} onChange={(e) => onChange({ known: e.target.checked })} /> Introduced (players see their name)
        </label>
        {text('appearance', 'Appearance', true)}
        {text('mannerism', 'Mannerism', true)}
        {text('want', 'Wants', true)}
        {text('secret', 'Secret (DM only)', true)}
        <label className="wide">
          Rumors and hooks (one per line)
          <textarea
            rows={3}
            value={npc.rumors.join('\n')}
            onChange={(e) =>
              onChange({
                rumors: e.target.value
                  .split('\n')
                  .map((s) => s.trimStart())
                  .filter((s, i, all) => s !== '' || i === all.length - 1),
              })
            }
          />
        </label>
        <label className="wide">
          Notes
          <textarea rows={2} value={npc.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} />
        </label>
      </div>
      {npc.shop && (
        <div className="npc-shop">
          <h3>For sale</h3>
          {stock.length === 0 ? (
            <p className="fine">Nothing in stock.</p>
          ) : (
            <ul>
              {stock.map((it) => (
                <li key={it.id}>
                  <span className="inv-name">{it.name}</span>
                  <span className="inv-value">{it.valueGp !== undefined ? `${it.valueGp} gp` : '—'}</span>
                  {onSell && party.length > 0 && (
                    <select
                      value=""
                      aria-label={`Sell ${it.name} to`}
                      onChange={(e) => {
                        const to = party.find((t) => t.id === e.target.value);
                        if (to) onSell(it, to);
                      }}
                    >
                      <option value="">Sell to…</option>
                      {party.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" className="link-button" aria-label={`Stop selling ${it.name}`} onClick={() => onChange({ shop: npc.shop!.filter((id) => id !== it.id) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <select
            value=""
            aria-label="Add an item to their stock"
            onChange={(e) => e.target.value && onChange({ shop: [...(npc.shop ?? []), e.target.value] })}
          >
            <option value="">+ Add from the item library…</option>
            {items
              .filter((i) => !npc.shop!.includes(i.id))
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        </div>
      )}
      <div className="row">
        {!npc.shop && (
          <button type="button" onClick={() => onChange({ shop: [] })}>
            Make a merchant
          </button>
        )}
        {onPlace && (
          <button type="button" onClick={onPlace}>
            Place token here
          </button>
        )}
        {onDelete && (
          <button type="button" className="danger" onClick={onDelete}>
            Delete NPC
          </button>
        )}
      </div>
    </section>
  );
}
