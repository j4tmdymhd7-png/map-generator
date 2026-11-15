import { useEffect, useRef } from 'react';
import { MAP_SIZES, SIZE_INFO, type MapKind, type MapSize } from '../core/generator/maps';
import { randomSeed } from '../core/rng';

interface Props {
  seed: string;
  size: MapSize;
  kind: MapKind;
  onSeed: (s: string) => void;
  onSize: (s: MapSize) => void;
  onKind: (k: MapKind) => void;
  /** Why the current map can't be replaced, if it can't. */
  replaceBlocked?: string;
  onAdd: () => void;
  onReplace: () => void;
  onClose: () => void;
}

/** Generate a map: pick a size and type; the seed makes it repeatable. */
export function NewMapDialog({ seed, size, kind, onSeed, onSize, onKind, replaceBlocked, onAdd, onReplace, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const done = (fn: () => void) => () => {
    fn();
    ref.current?.close();
  };
  return (
    <dialog ref={ref} className="library small-dialog" onClose={onClose} aria-label="New map">
      <header>
        <h2>New map</h2>
        <span className="spacer" />
        <button type="button" onClick={() => ref.current?.close()}>
          Close
        </button>
      </header>
      <div className="lib-detail dialog-form">
        <fieldset className="size-picker">
          <legend>Size</legend>
          {MAP_SIZES.map((s) => (
            <label key={s} className={`size-option${s === size ? ' on' : ''}`}>
              <input
                type="radio"
                name="size"
                checked={s === size}
                onChange={() => {
                  onSize(s);
                  onKind(SIZE_INFO[s].kinds[0].kind);
                }}
              />
              <strong>{SIZE_INFO[s].label}</strong>
              <small>{SIZE_INFO[s].blurb}</small>
            </label>
          ))}
        </fieldset>
        <label>
          Type
          <select value={kind} onChange={(e) => onKind(e.target.value as MapKind)}>
            {SIZE_INFO[size].kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label title="The same seed, size and type always make the same map">
          Seed
          <span className="row">
            <input value={seed} onChange={(e) => onSeed(e.target.value)} aria-label="Generator seed" />
            <button type="button" onClick={() => onSeed(randomSeed())}>
              Random
            </button>
          </span>
        </label>
      </div>
      <footer className="row">
        <button type="button" className="primary" onClick={done(onAdd)} title="Add this map to the campaign and move the party onto it">
          Add to campaign
        </button>
        <button type="button" onClick={done(onReplace)} disabled={!!replaceBlocked} title={replaceBlocked ?? 'Throw away the map on screen and use this one instead'}>
          Replace current map
        </button>
      </footer>
    </dialog>
  );
}
