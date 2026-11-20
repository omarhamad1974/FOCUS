import { defaultAvatar } from './avatars';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const COLORS = ['#0b55a8', '#e01b2a', '#36a52a', '#f08c00', '#1b8fd6', '#1b8fd6', '#7ed957', '#4cb83a', '#c2410c', '#1b8fd6'];

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

export function colorFor(s: string): string {
  return COLORS[hash(s) % COLORS.length];
}

export function groupColor(i: number): string {
  return COLORS[i % COLORS.length];
}

/**
 * A person's round picture: their photo, else a table tennis player drawn for
 * their gender (or a paddle when the gender is not known). The name is kept as
 * the tooltip.
 */
export function avatar(name: string, photo?: string | null, gender?: string | null): string {
  if (photo) return `<img class="avatar photo" src="${esc(photo)}" alt="" title="${esc(name)}" loading="lazy" decoding="async">`;
  return `<img class="avatar photo drawn" src="${defaultAvatar(gender)}" alt="" title="${esc(name)}" decoding="async">`;
}

/** Avatar for anything shaped like a profile. */
export const avatarOf = (p: { full_name?: string | null; avatar_url?: string | null; gender?: string | null } | null | undefined, fallbackName = '?') =>
  avatar(p?.full_name || fallbackName, p?.avatar_url, p?.gender);

let toastTimer = 0;
export function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2400);
}

export function confetti(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f5b301', '#e01b2a', '#0b55a8', '#36a52a', '#fff'];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 4200);
  }
}
