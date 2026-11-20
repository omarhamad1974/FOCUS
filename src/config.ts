/**
 * Supabase connection. The anon key is public by design: Row Level Security
 * in supabase/migrations decides what each user may read and change.
 * Pingo's project is the default; environment variables override it.
 */
const env = import.meta.env;

/** Set VITE_OFFLINE=1 to build the browser-storage-only version. */
const offline = env.VITE_OFFLINE === '1';

export const SUPABASE_URL: string = offline ? '' : env.VITE_SUPABASE_URL || 'https://xjfttraweunhwxlgeagz.supabase.co';
export const SUPABASE_ANON_KEY: string = offline ? '' : env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_7y0pH6Ca398DkJW78VoTXg_HK60CCpB';

export const online = (): boolean => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Pingo support on WhatsApp: the number in international form, digits only,
 * without + or leading zeros (for example 201001234567 for an Egyptian mobile).
 * Set it to an empty string to hide the floating support button.
 */
const SUPPORT_NUMBER = '201006552256'; // Pingo support (Omar, 2026-11-20)
export const SUPPORT_WHATSAPP: string = (env.VITE_SUPPORT_WHATSAPP || SUPPORT_NUMBER).replace(/\D/g, '');
