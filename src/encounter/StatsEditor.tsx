import { useState } from 'react';
import { ABILITIES, type StatBlock, type Token } from '../core/model/types';
import { ABILITY_LABEL, abilityMod, applyHp, CONDITIONS, defaultStats, formatMod } from '../core/stats';

const num = (v: string, fallback = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/** Editable stat block, HP tracker and conditions for one token. */
export function StatsEditor({ token, onChange }: { token: Token; onChange: (patch: Partial<Token>) => void }) {
  const [amount, setAmount] = useState('');
  const s = token.stats;
  if (!s) {
    return (
      <button type="button" onClick={() => onChange({ stats: defaultStats() })}>
        Add stat block
      </button>
    );
  }
  const set = (patch: Partial<StatBlock>) => onChange({ stats: { ...s, ...patch } });
  const hit = (sign: 1 | -1) => {
    const n = Math.abs(num(amount));
    if (!n) return;
    onChange({ stats: applyHp(s, sign * n) });
    setAmount('');
  };
  const toggleCondition = (c: string) =>
    onChange({ conditions: token.conditions.includes(c) ? token.conditions.filter((x) => x !== c) : [...token.conditions, c] });

  return (
    <div className="stats">
      <div className="stat-row">
        <label>
          AC
          <input type="number" value={s.ac} onChange={(e) => set({ ac: num(e.target.value, s.ac) })} />
        </label>
        <label>
          HP
          <input type="number" value={s.hp} onChange={(e) => set({ hp: num(e.target.value, s.hp) })} />
        </label>
        <label>
          Max
          <input type="number" min={0} value={s.maxHp} onChange={(e) => set({ maxHp: Math.max(0, num(e.target.value, s.maxHp)) })} />
        </label>
        <label>
          Temp
          <input type="number" min={0} value={s.tempHp ?? 0} onChange={(e) => set({ tempHp: Math.max(0, num(e.target.value)) || undefined })} />
        </label>
      </div>
      <div className="hp-adjust">
        <input
          type="number"
          min={0}
          placeholder="Amount"
          value={amount}
          aria-label="Damage or healing amount"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && hit(1)}
        />
        <button type="button" onClick={() => hit(1)}>
          Damage
        </button>
        <button type="button" onClick={() => hit(-1)}>
          Heal
        </button>
      </div>
      <div className="abilities">
        {ABILITIES.map((a) => (
          <label key={a}>
            <span>{ABILITY_LABEL[a]}</span>
            <input
              type="number"
              min={1}
              max={30}
              value={s.abilities[a]}
              onChange={(e) => set({ abilities: { ...s.abilities, [a]: Math.min(30, Math.max(1, num(e.target.value, 10))) } })}
            />
            <small>{formatMod(abilityMod(s.abilities[a]))}</small>
          </label>
        ))}
      </div>
      <label className="wide">
        Challenge rating
        <input value={s.cr ?? ''} placeholder="e.g. 1/4" onChange={(e) => set({ cr: e.target.value || undefined })} />
      </label>
      <label className="wide">
        Actions &amp; traits
        <textarea rows={3} value={s.actions ?? ''} onChange={(e) => set({ actions: e.target.value || undefined })} />
      </label>
      <label className="wide">
        DM notes
        <textarea rows={2} value={s.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
      </label>
      <fieldset className="conditions">
        <legend>Conditions</legend>
        {CONDITIONS.map((c) => (
          <label key={c.name} className={token.conditions.includes(c.name) ? 'chip on' : 'chip'}>
            <input type="checkbox" checked={token.conditions.includes(c.name)} onChange={() => toggleCondition(c.name)} />
            {c.name[0].toUpperCase() + c.name.slice(1)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
