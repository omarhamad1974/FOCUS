import type { Tournament } from './types';

const KEY = 'pingo.v1';

export interface AppData {
  version: 1;
  tournaments: Tournament[];
}

const empty = (): AppData => ({ version: 1, tournaments: [] });

export function load(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw) as AppData;
    return data && Array.isArray(data.tournaments) ? data : empty();
  } catch {
    return empty();
  }
}

export function save(data: AppData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Parse a backup file. Throws on anything that is not a Pingo backup. */
export function parseBackup(text: string): AppData {
  const data = JSON.parse(text);
  if (!data || data.version !== 1 || !Array.isArray(data.tournaments)) throw new Error('invalid');
  return data as AppData;
}
