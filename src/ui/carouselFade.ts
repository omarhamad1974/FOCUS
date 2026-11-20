/* News carousel in fade mode: the current article fades out, a quick Pingo logo
   (built from the splash layers) pops up in the middle, and the next article
   fades in. With reduced motion it is a short cross-fade with no logo. */

const LAYERS: [string, number, number, number][] = [
  // name, left %, top %, width % (logo pixels 640 x 428, see scripts/splash-layers.py)
  ['swoosh-red', 13.44, 21.5, 45.0],
  ['swoosh-blue', 11.56, 73.36, 78.75],
  ['paddle', 49.22, 0, 47.34],
  ['p', 0, 47.2, 29.38],
  ['i', 24.53, 44.16, 14.37],
  ['n', 32.81, 54.21, 24.06],
  ['g', 54.22, 53.04, 25.16],
  ['o', 76.88, 51.87, 23.12],
];

/** The layered logo shown between two articles (hidden until a change). */
export function carLogo(base: string): string {
  return `<div class="car-logo" aria-hidden="true"><div class="car-logo-card"><div class="car-logo-art" dir="ltr">
    ${LAYERS.map(([n, l, tp, w]) => `<img class="cl-${n}" src="${base}brand/splash/${n}.png" alt="" style="left:${l}%;top:${tp}%;width:${w}%" loading="lazy" decoding="async">`).join('')}
    <span class="cl-ring"></span><span class="cl-ball"></span></div></div></div>`;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fill = (delay: number, duration: number, easing = 'ease-out'): KeyframeAnimationOptions =>
  ({ delay, duration, easing, fill: 'both' });

/** Logo interlude, about 0.75 s. */
function playLogo(c: HTMLElement): void {
  const box = c.querySelector<HTMLElement>('.car-logo');
  if (!box || typeof box.animate !== 'function') return;
  const $ = (s: string) => box.querySelector<HTMLElement>(s);
  box.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  const card = $('.car-logo-card')!;
  card.animate([
    { opacity: 0, transform: 'scale(.6) rotate(-4deg)' },
    { opacity: 1, transform: 'scale(1.04)', offset: 0.16 },
    { opacity: 1, transform: 'scale(1)', offset: 0.24 },
    { opacity: 1, transform: 'scale(1)', offset: 0.8 },
    { opacity: 0, transform: 'scale(1.08)' },
  ], { duration: 760, easing: 'ease-out', fill: 'both' });
  ['p', 'i', 'n', 'g', 'o'].forEach((n, i) => {
    const el = $(`.cl-${n}`)!;
    el.style.transformOrigin = '50% 100%';
    el.animate([
      { opacity: 0, transform: 'translateY(30%) scale(.4)' },
      { opacity: 1, transform: 'translateY(-8%) scale(1.12)', offset: 0.6 },
      { opacity: 1, transform: 'none' },
    ], fill(70 + i * 45, 240));
  });
  const paddle = $('.cl-paddle')!;
  paddle.style.transformOrigin = '2% 98%';
  paddle.animate([
    { opacity: 0, transform: 'rotate(55deg)' },
    { opacity: 1, offset: 0.4 },
    { transform: 'rotate(-6deg)', offset: 0.8 },
    { opacity: 1, transform: 'none' },
  ], fill(150, 300, 'cubic-bezier(.3,.6,.35,1)'));
  $('.cl-ball')!.animate([
    { opacity: 0, transform: 'translateY(-260%)' },
    { opacity: 1, transform: 'translateY(-260%)', offset: 0.1 },
    { transform: 'translateY(0) scale(1.2, .8)', offset: 0.62 },
    { transform: 'translateY(-70%)', offset: 0.82 },
    { opacity: 1, transform: 'none' },
  ], fill(200, 360, 'ease-in'));
  $('.cl-ring')!.animate([{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.6)' }],
    { delay: 430, duration: 320, easing: 'ease-out' });
  $('.cl-swoosh-red')!.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], fill(260, 260, 'cubic-bezier(.4,0,.2,1)'));
  $('.cl-swoosh-blue')!.animate([{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }], fill(300, 260, 'cubic-bezier(.4,0,.2,1)'));
}

/** Show slide `k` of a fade carousel. Returns false while a change is still running. */
export function fadeTo(c: HTMLElement, k: number): boolean {
  const slides = Array.from(c.querySelectorAll<HTMLElement>('.car-slide'));
  const from = slides.findIndex((s) => s.classList.contains('on'));
  if (k === from || c.dataset.busy) return false;
  const out = slides[from], inn = slides[k];
  const show = (el: HTMLElement, on: boolean) => { el.classList.toggle('on', on); el.inert = !on; };
  if (!out || typeof inn.animate !== 'function') {
    slides.forEach((s, i) => show(s, i === k));
    return true;
  }
  c.dataset.busy = '1';
  const quick = reduced();
  const outMs = quick ? 180 : 280, inAt = quick ? 0 : 640, inMs = quick ? 220 : 360;
  out.animate([{ opacity: 1 }, { opacity: 0 }], { duration: outMs, easing: 'ease-in', fill: 'forwards' })
    .finished.then((a) => { show(out, false); a.cancel(); }).catch(() => {});
  if (!quick) setTimeout(() => playLogo(c), 140);
  setTimeout(() => {
    show(inn, true);
    inn.animate([{ opacity: 0, transform: 'scale(1.02)' }, { opacity: 1, transform: 'none' }], { duration: inMs, easing: 'ease-out' })
      .finished.finally(() => { delete c.dataset.busy; });
  }, inAt);
  return true;
}

/** Swipe left/right on a fade carousel to change article (taps still open the article). */
export function fadeSwipe(c: HTMLElement, step: (d: number) => void): void {
  let x0 = 0, y0 = 0, swiped = false;
  c.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; swiped = false; }, { passive: true });
  c.addEventListener('pointerup', (e) => {
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    swiped = true;
    const rtl = getComputedStyle(c).direction === 'rtl';
    step((dx > 0) === rtl ? 1 : -1);
  });
  c.addEventListener('click', (e) => { if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false; } }, true);
}
