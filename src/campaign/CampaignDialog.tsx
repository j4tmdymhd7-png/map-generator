import { useEffect, useRef, useState } from 'react';
import { deleteCampaign, listCampaigns, type CampaignSummary } from './storage';

interface Props {
  currentId: string;
  name: string;
  onRename: (name: string) => void;
  onOpen: (id: string) => void;
  onNew: (name: string) => void;
  onExport: () => void;
  onImport: (file: File) => Promise<string | null>;
  onClose: () => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
};

/** Save slots: rename, switch, start a new campaign, back up to a file. */
export function CampaignDialog({ currentId, name, onRename, onOpen, onNew, onExport, onImport, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<CampaignSummary[] | null>(null);
  const [newName, setNewName] = useState('New campaign');
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    let live = true;
    listCampaigns()
      .then((l) => live && setSaved(l))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [refresh]);

  return (
    <dialog ref={ref} className="library campaign-dialog" onClose={onClose} aria-label="Campaigns">
      <header>
        <h2>Campaigns</h2>
        <span className="spacer" />
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close campaigns">
          Close
        </button>
      </header>
      <div className="lib-detail campaign-body">
        <section>
          <h3>This campaign</h3>
          <label className="inline">
            Name <input value={name} onChange={(e) => onRename(e.target.value)} />
          </label>
          <p className="fine">Saved automatically in this browser as you play. Export a file to back it up or move it to another computer.</p>
          <div className="row">
            <button type="button" onClick={onExport}>
              Export to file
            </button>
            <button type="button" onClick={() => file.current?.click()}>
              Import a file…
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setError(await onImport(f));
              }}
            />
          </div>
          {error && (
            <p className="panel-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <section>
          <h3>Start a new campaign</h3>
          <div className="row">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New campaign name" />
            <button type="button" className="primary" onClick={() => onNew(newName.trim() || 'New campaign')}>
              Start
            </button>
          </div>
          <p className="fine">Uses the seed, size and type in the toolbar for its first map. This campaign stays saved.</p>
        </section>
        <section>
          <h3>Saved in this browser</h3>
          {!saved ? (
            <p className="fine">Loading…</p>
          ) : saved.length === 0 ? (
            <p className="fine">Nothing saved yet.</p>
          ) : (
            <ul className="place-list">
              {saved.map((c) => (
                <li key={c.id}>
                  <strong>{c.name || 'Untitled'}</strong>{' '}
                  <small>
                    {c.maps} map{c.maps === 1 ? '' : 's'} · {when(c.updatedAt)}
                  </small>{' '}
                  {c.id === currentId ? (
                    <em className="fine">open now</em>
                  ) : (
                    <>
                      <button type="button" onClick={() => onOpen(c.id)}>
                        Open
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete “${c.name}” from this browser? This can’t be undone (unless you exported it).`)) return;
                          await deleteCampaign(c.id);
                          setRefresh((r) => r + 1);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </dialog>
  );
}
