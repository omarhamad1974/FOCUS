export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const COLORS = ['#3b5bfd', '#e5484d', '#12a37f', '#f08c00', '#8e4ec6', '#0091ff', '#d6409f', '#2b9a66', '#c2410c', '#5b5bd6'];

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

export function avatar(name: string, photo?: string | null): string {
  if (photo) return `<img class="avatar photo" src="${esc(photo)}" alt="" loading="lazy" decoding="async">`;
  const first = [...name.trim()][0] ?? '?';
  return `<span class="avatar" style="background:${colorFor(name)}" aria-hidden="true">${esc(first)}</span>`;
}

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
  const colors = ['#f5b301', '#e5484d', '#3b5bfd', '#12a37f', '#fff'];
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
