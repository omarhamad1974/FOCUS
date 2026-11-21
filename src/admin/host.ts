/**
 * What the role tools borrow from the main app: the tournaments in memory and
 * how to save them. Set once by main.ts, so the tools stay in their own files.
 */
import type { Tournament } from '../domain/types';

export interface Host {
  tournaments: () => Tournament[];
  /** Save changed tournaments (to Supabase, or this browser offline). */
  persist: () => void;
  /** Add a new tournament and save it. */
  add: (t: Tournament) => void;
  /** Reload everything from the server. */
  refresh: () => Promise<void>;
}

export const host: Host = {
  tournaments: () => [],
  persist: () => undefined,
  add: () => undefined,
  refresh: async () => undefined,
};

export function setHost(h: Host): void {
  Object.assign(host, h);
}
