import { useRef, useState } from 'react';
import { SIZES, type Side, type Size, type Token } from '../core/model/types';
import { initials, portraitFromFile } from '../renderer/avatars';
import type { Encounter } from './useEncounter';

const SIDE_LABEL: Record<Side, string> = { party: 'Party', enemy: 'Enemy', neutral: 'Neutral' };

function Avatar({ t }: { t: Token }) {
  return t.image ? (
    <img className="avatar-thumb" src={t.image} alt="" />
  ) : (
    <span className="avatar-thumb initials" style={{ background: `color-mix(in srgb, ${t.color} 35%, #fbf6e8)` }} aria-hidden>
      {initials(t.label)}
    </span>
  );
}

export function TokenPanel({
  enc,
  onNewRound,
  hideFromPlayers,
  children,
}: {
  enc: Encounter;
  onNewRound: () => void;
  /** In player view: tokens the players can't currently see are left out of the list. */
  hideFromPlayers?: (t: Token) => boolean;
  children?: React.ReactNode;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickPortrait = (id: string) => {
    setUploadFor(id);
    fileInput.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadFor) return;
    try {
      enc.updateToken(uploadFor, { image: await portraitFromFile(file) });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that image.');
    }
  };

  return (
    <aside className="token-panel" aria-label="Tokens">
      {children}
      <h2>Tokens</h2>
      <div className="panel-actions">
        <button type="button" onClick={enc.addToken}>
          + Add token
        </button>
        <button type="button" onClick={enc.undo} disabled={!enc.canUndo}>
          Undo move
        </button>
        <button type="button" onClick={onNewRound} title="Reset everyone's movement">
          New round
        </button>
      </div>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFile} />
      {error && (
        <p className="panel-error" role="alert">
          {error}
        </p>
      )}
      <ul className="token-list">
        {enc.tokens.filter((t) => !hideFromPlayers?.(t)).map((t) => {
          const selected = enc.selected?.id === t.id;
          return (
            <li key={t.id} className={selected ? 'token-row selected' : 'token-row'}>
              <div className="token-head">
                <button
                  type="button"
                  className="avatar-button"
                  onClick={() => pickPortrait(t.id)}
                  aria-label={`Change portrait for ${t.label}`}
                  title="Change portrait"
                >
                  <Avatar t={t} />
                </button>
                <input
                  className="token-name"
                  value={t.label}
                  onChange={(e) => enc.updateToken(t.id, { label: e.target.value })}
                  aria-label="Token name"
                />
                <button
                  type="button"
                  className="select-button"
                  aria-pressed={selected}
                  onClick={() => enc.select(selected ? null : t.id)}
                >
                  {selected ? 'Selected' : 'Select'}
                </button>
              </div>
              <div className="token-meta">
                <span>
                  Move{' '}
                  <strong>
                    {enc.remaining(t)}/{t.speeds.walk} ft
                  </strong>
                </span>
                {t.image && (
                  <button type="button" className="link-button" onClick={() => enc.updateToken(t.id, { image: undefined })}>
                    Remove portrait
                  </button>
                )}
              </div>
              {selected && (
                <div className="token-fields">
                  <label>
                    Side
                    <select value={t.side} onChange={(e) => enc.updateToken(t.id, { side: e.target.value as Side })}>
                      {(Object.keys(SIDE_LABEL) as Side[]).map((s) => (
                        <option key={s} value={s}>
                          {SIDE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Size
                    <select value={t.size} onChange={(e) => enc.updateToken(t.id, { size: e.target.value as Size })}>
                      {SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s[0].toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Speed (ft)
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={t.speeds.walk}
                      onChange={(e) => enc.updateToken(t.id, { speeds: { ...t.speeds, walk: Math.max(0, Number(e.target.value) || 0) } })}
                    />
                  </label>
                  <label>
                    Color
                    <input type="color" value={t.color} onChange={(e) => enc.updateToken(t.id, { color: e.target.value })} />
                  </label>
                  <button type="button" className="danger" onClick={() => enc.removeToken(t.id)}>
                    Remove token
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <details className="assumptions">
        <summary>Movement rules in use</summary>
        <ul>
          {enc.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p>Hold Shift when clicking a square to override the rules and place the selected token anywhere.</p>
        <p>Doors: click (or right-click) to open/close, Shift-click to lock/unlock, or press O next to one.</p>
        <p>Sight is simple line of sight within the party's sight range. It doesn't model light or darkvision.</p>
        <p>Token rings: party = solid, enemy = spiked, neutral = dashed.</p>
      </details>
    </aside>
  );
}
