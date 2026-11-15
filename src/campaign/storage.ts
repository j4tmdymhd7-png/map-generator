/**
 * Campaign saves in the browser (IndexedDB: room for several 200 × 200 maps,
 * which localStorage can't hold), plus file export and import.
 *
 * Everything stays on this device. Export a file to back up or move a campaign.
 */
import { parseCampaign } from '../core/model/schema';
import type { Campaign } from '../core/model/types';

const DB = 'dungeon-map-generator';
const STORE = 'campaigns';
const LAST_KEY = 'dmg.lastCampaign.v1';

export interface CampaignSummary {
  id: string;
  name: string;
  updatedAt: string;
  maps: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no IndexedDB storage.'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open storage.'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error('Storage error.'));
      t.onabort = () => reject(t.error ?? new Error('Storage full or blocked.'));
    });
  } finally {
    db.close();
  }
}

export async function saveCampaign(c: Campaign): Promise<void> {
  await tx('readwrite', (s) => s.put(c));
  rememberLast(c.id);
}

export async function loadCampaign(id: string): Promise<Campaign | null> {
  const raw = await tx('readonly', (s) => s.get(id) as IDBRequest<unknown>);
  if (!raw) return null;
  const res = parseCampaign(raw);
  if (!res.ok) {
    console.warn('Saved campaign failed validation', res.errors.slice(0, 5));
    return null;
  }
  return res.campaign;
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<Campaign[]>);
  return all
    .map((c) => ({ id: c.id, name: c.name, updatedAt: c.updatedAt ?? '', maps: c.maps?.length ?? 0 }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteCampaign(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export function lastCampaignId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function rememberLast(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // ignore
  }
}

/** Download the campaign as a JSON file. */
export function exportCampaign(c: Campaign) {
  const blob = new Blob([JSON.stringify(c)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = c.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'campaign';
  a.download = `${safe}.campaign.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Read a campaign file. Throws with a readable message when it isn't one. */
export async function importCampaignFile(file: File): Promise<Campaign> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  const res = parseCampaign(data);
  if (!res.ok) throw new Error(`Not a campaign file: ${res.errors.slice(0, 3).join('; ')}`);
  return res.campaign;
}
