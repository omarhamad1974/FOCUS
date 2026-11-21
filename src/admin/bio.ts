/**
 * "About me" card shown at the top of the organizer, trainer and seller tools.
 * The biography is optional; it appears on the person's public page (#/u/<id>),
 * the trainer's page and next to their products.
 */
import { t } from '../i18n/ar';
import * as remote from '../data/remote';
import * as content from '../data/content';
import { authErr, render, session } from '../app/ctx';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast } from '../ui/util';

let open = false;
let busy = false;

export function card(): string {
  const p = session.profile;
  if (!p) return '';
  const bio = p.bio?.trim() ?? '';
  return `<details class="card dk-bio" ${open ? 'open' : ''}>
    <summary data-act="dk-bio-toggle">${avatarOf(p)}<span class="dk-who"><b>✍️ ${t('bio.title')}</b>
      <small class="muted clamp" dir="auto">${bio ? esc(bio) : t('bio.empty')}</small></span>
      <span class="badge ${bio ? 'green' : ''}">${bio ? t('bio.filled') : t('bio.optional')}</span></summary>
    <p class="hint">${esc(t('bio.hint'))}</p>
    <textarea class="input" id="dkBio" dir="auto" maxlength="600" style="min-height:110px" placeholder="${esc(t('bio.ph'))}">${esc(bio)}</textarea>
    <div class="row between"><small class="muted">${t('bio.limit')}</small>
      <span class="row"><a class="btn soft small" href="#/u/${esc(p.id)}">${icon('eye', 14)} ${t('bio.preview')}</a>
      <button class="btn green small" data-act="dk-bio-save" ${busy ? 'disabled' : ''}>${icon('check', 14)} ${t('desk.save')}</button></span></div>
  </details>`;
}

export async function onClick(act: string): Promise<boolean> {
  if (act === 'dk-bio-toggle') { open = !open; return true; }
  if (act !== 'dk-bio-save' || !session.profile) return false;
  const box = document.getElementById('dkBio') as HTMLTextAreaElement | null;
  const bio = box?.value.trim() || null;
  busy = true; render();
  try {
    await remote.updateProfile(session.profile.id, { bio });
    session.profile.bio = bio;
    content.forgetPerson(session.profile.id);
    open = false;
    toast(`✅ ${t('bio.saved')}`);
  } catch (e) { toast(authErr(e)); }
  busy = false; render();
  return true;
}
