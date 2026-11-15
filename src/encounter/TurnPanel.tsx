import type { Token } from '../core/model/types';
import { initials } from '../renderer/avatars';
import type { Encounter } from './useEncounter';

interface Props {
  enc: Encounter;
  onNextRound: () => void;
  onStartCombat: () => void;
  onEndTurn: () => void;
  /** In player view: creatures the players can't see are left out. */
  hidden?: (t: Token) => boolean;
}

export function TurnPanel({ enc, onNextRound, onStartCombat, onEndTurn, hidden }: Props) {
  const byId = new Map(enc.tokens.map((t) => [t.id, t]));
  const combat = enc.combat;
  const outside = combat ? enc.tokens.filter((t) => !combat.order.some((e) => e.tokenId === t.id) && !hidden?.(t)) : [];

  return (
    <section className="turn-panel" aria-label="Turns">
      <h2>
        Round {enc.round} <span className="turn-mode">{combat ? 'Combat' : 'Exploring'}</span>
      </h2>
      {!combat ? (
        <>
          <div className="row">
            <button type="button" className="primary" onClick={onNextRound} title="Everyone's movement resets; unseen monsters may move (N)">
              Next round
            </button>
            <button type="button" onClick={onStartCombat} title="Roll initiative (d20 + bonus) for the party and every creature they can see">
              Start combat
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="initiative">
            {combat.order.map((e, i) => {
              const t = byId.get(e.tokenId);
              if (!t || hidden?.(t)) return null;
              const active = i === combat.turn;
              return (
                <li key={e.tokenId} className={active ? 'active' : ''} aria-current={active ? 'true' : undefined}>
                  <span className="turn-marker" aria-hidden>
                    {active ? '▶' : ''}
                  </span>
                  <span className="mini-avatar" aria-hidden>
                    {t.image ? <img src={t.image} alt="" /> : initials(t.label)}
                  </span>
                  <button type="button" className="link-button name" onClick={() => enc.select(t.id)}>
                    {t.label}
                  </button>
                  <input
                    type="number"
                    className="init-input"
                    value={e.total}
                    aria-label={`Initiative for ${t.label}`}
                    title={`Rolled ${e.roll} ${e.bonus >= 0 ? '+' : '−'} ${Math.abs(e.bonus)}`}
                    onChange={(ev) => enc.setInitiative(e.tokenId, Number(ev.target.value) || 0)}
                  />
                  <span className="init-move">{enc.remaining(t)} ft</span>
                </li>
              );
            })}
          </ol>
          <div className="row">
            <button type="button" className="primary" onClick={onEndTurn} title="Shortcut: N">
              End turn
            </button>
            <button type="button" onClick={enc.endCombat}>
              End combat
            </button>
          </div>
          {outside.length > 0 && (
            <label className="join">
              Add to initiative
              <select
                value=""
                onChange={(ev) => {
                  const t = byId.get(ev.target.value);
                  if (t) enc.joinCombat(t);
                }}
              >
                <option value="">Choose a creature…</option>
                {outside.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </section>
  );
}
