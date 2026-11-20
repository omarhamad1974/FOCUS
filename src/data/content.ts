import { db, getSession } from './remote';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ------------------------------------------------------------ people */

export interface PublicProfile {
  id: string;
  full_name: string;
  club: string | null;
  bio: string | null;
  is_seller: boolean;
  is_trainer: boolean;
  avatar_url: string | null;
  gender?: 'male' | 'female' | null;
}

const peopleCache = new Map<string, PublicProfile>();

/** Public cards (name, club, bio) for the given account ids, cached. */
export async function people(ids: string[]): Promise<Map<string, PublicProfile>> {
  const missing = [...new Set(ids)].filter((id) => id && !peopleCache.has(id));
  if (missing.length) {
    const rows = check(await db().from('public_profiles').select('*').in('id', missing)) as PublicProfile[];
    for (const r of rows) peopleCache.set(r.id, r);
  }
  return peopleCache;
}

export const personName = (id: string) => peopleCache.get(id)?.full_name ?? '';
export const person = (id: string) => peopleCache.get(id);
export const forgetPeople = () => peopleCache.clear();

export const photoOf = (id: string | undefined) => (id ? peopleCache.get(id)?.avatar_url ?? null : null);
export const genderOf = (id: string | undefined) => (id ? peopleCache.get(id)?.gender ?? null : null);

/** Everyone with an account whose name matches (for picking assistants). */
export async function searchPeople(q: string): Promise<PublicProfile[]> {
  const rows = check(await db().from('public_profiles').select('*').ilike('full_name', `%${q.replace(/[%_]/g, '')}%`).limit(8)) as PublicProfile[];
  for (const r of rows) peopleCache.set(r.id, r);
  return rows;
}

export async function trainers(): Promise<PublicProfile[]> {
  const rows = check(await db().from('public_profiles').select('*').eq('is_trainer', true).order('full_name')) as PublicProfile[];
  for (const r of rows) peopleCache.set(r.id, r);
  return rows;
}

/* ------------------------------------------------------------- roles */

export type ExtraRole = 'organizer' | 'seller' | 'trainer';

export interface RoleRequest {
  id: string;
  user_id: string;
  role: ExtraRole;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export async function myRoleRequests(): Promise<RoleRequest[]> {
  const s = await getSession();
  if (!s) return [];
  return check(await db().from('role_requests').select('*').eq('user_id', s.user.id)) as RoleRequest[];
}

export async function pendingRoleRequests(): Promise<RoleRequest[]> {
  return check(await db().from('role_requests').select('*').eq('status', 'pending').order('created_at')) as RoleRequest[];
}

export async function requestRole(role: ExtraRole, note = ''): Promise<void> {
  check(await db().rpc('request_role', { r: role, note }));
}

export async function decideRoleRequest(id: string, approve: boolean): Promise<void> {
  check(await db().rpc('decide_role_request', { req: id, approve }));
}

export async function setRoles(id: string, roles: { is_organizer?: boolean; is_seller?: boolean; is_trainer?: boolean; role?: string }): Promise<void> {
  check(await db().from('profiles').update(roles).eq('id', id));
}

/** Same profile change for many accounts (admin only). */
export async function setRolesMany(ids: string[], roles: Record<string, unknown>): Promise<void> {
  for (const part of chunks(ids)) check(await db().from('profiles').update(roles).in('id', part));
}

/** Split long id lists so each request stays short. */
export function chunks<T>(ids: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/* -------------------------------------------------------------- news */

export type PostCategory = 'news' | 'learn' | 'tips' | 'events' | 'gear' | 'other';
export const POST_CATEGORIES: PostCategory[] = ['news', 'learn', 'tips', 'events', 'gear', 'other'];

export interface Post {
  id: string;
  author_id: string;
  title: string;
  summary: string | null;
  body: string;
  category: PostCategory;
  cover_url: string | null;
  published: boolean;
  created_at: string;
}

export async function listPosts(limit = 60): Promise<Post[]> {
  return check(await db().from('posts').select('*').order('created_at', { ascending: false }).limit(limit)) as Post[];
}

export async function savePost(p: Partial<Post> & { title: string }): Promise<Post> {
  const { id, author_id: _a, created_at: _c, ...fields } = p;
  if (id) return check(await db().from('posts').update(fields).eq('id', id).select('*').single()) as Post;
  return check(await db().from('posts').insert(fields).select('*').single()) as Post;
}

export async function deletePost(id: string): Promise<void> {
  check(await db().from('posts').delete().eq('id', id));
}

export async function deletePosts(ids: string[]): Promise<void> {
  for (const part of chunks(ids)) check(await db().from('posts').delete().in('id', part));
}

/* -------------------------------------------------------------- shop */

export type ProductCategory = 'rackets' | 'rubbers' | 'balls' | 'tables' | 'clothing' | 'shoes' | 'bags' | 'accessories' | 'other';
export const PRODUCT_CATEGORIES: ProductCategory[] = ['rackets', 'rubbers', 'balls', 'tables', 'clothing', 'shoes', 'bags', 'accessories', 'other'];

export interface Product {
  id: string;
  seller_id: string;
  name: string;
  description: string | null;
  category: ProductCategory;
  price: number;
  stock: number;
  image_url: string | null;
  active: boolean;
  approved: boolean;
  featured: boolean;
  created_at: string;
}

export type OrderStatus = 'pending' | 'confirmed' | 'delivered' | 'cancelled';

export interface Order {
  id: string;
  product_id: string | null;
  product_name: string;
  seller_id: string;
  buyer_id: string;
  qty: number;
  total: number;
  phone: string | null;
  note: string | null;
  status: OrderStatus;
  created_at: string;
}

export async function listProducts(): Promise<Product[]> {
  const rows = check(await db().from('products').select('*').order('created_at', { ascending: false })) as Product[];
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
}

export async function saveProduct(p: Partial<Product> & { name: string }): Promise<Product> {
  const { id, seller_id: _s, created_at: _c, ...fields } = p;
  const q = id ? db().from('products').update(fields).eq('id', id) : db().from('products').insert(fields);
  return check(await q.select('*').single()) as Product;
}

export async function setProductFlags(id: string, f: { approved?: boolean; featured?: boolean }): Promise<void> {
  check(await db().from('products').update(f).eq('id', id));
}

export async function deleteProduct(id: string): Promise<void> {
  check(await db().from('products').delete().eq('id', id));
}

export async function deleteProducts(ids: string[]): Promise<void> {
  for (const part of chunks(ids)) check(await db().from('products').delete().in('id', part));
}

export async function placeOrder(productId: string, qty: number, phone: string, note: string): Promise<string> {
  return check(await db().rpc('place_order', { p: productId, q: qty, phone, note })) as string;
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  check(await db().rpc('set_order_status', { o: id, s: status }));
}

export async function myOrders(): Promise<Order[]> {
  const s = await getSession();
  if (!s) return [];
  const rows = check(await db().from('orders').select('*').eq('buyer_id', s.user.id).order('created_at', { ascending: false })) as Order[];
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

export async function salesOrders(): Promise<Order[]> {
  const s = await getSession();
  if (!s) return [];
  const rows = check(await db().from('orders').select('*').eq('seller_id', s.user.id).order('created_at', { ascending: false })) as Order[];
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

export async function myBuyers(): Promise<Map<string, { full_name: string; phone: string | null }>> {
  const rows = check(await db().rpc('my_buyers')) as { order_id: string; full_name: string; phone: string | null }[];
  return new Map(rows.map((r) => [r.order_id, r]));
}

/* ---------------------------------------------------------- training */

export interface Location {
  id: string;
  trainer_id: string;
  name: string;
  address: string | null;
  map_url: string | null;
}

export interface Slot {
  id: string;
  trainer_id: string;
  location_id: string;
  starts_at: string;
  price: number;
  note: string | null;
  booked: boolean;
}

export interface Booking {
  id: string;
  slot_id: string;
  trainer_id: string;
  player_id: string;
  note: string | null;
  status: 'booked' | 'cancelled';
  created_at: string;
}

export async function listLocations(trainerId?: string): Promise<Location[]> {
  let q = db().from('training_locations').select('*').order('name');
  if (trainerId) q = q.eq('trainer_id', trainerId);
  return check(await q) as Location[];
}

export async function saveLocation(l: Partial<Location> & { name: string }): Promise<Location> {
  const { id, trainer_id: _t, ...fields } = l;
  const q = id ? db().from('training_locations').update(fields).eq('id', id) : db().from('training_locations').insert(fields);
  return check(await q.select('*').single()) as Location;
}

export async function deleteLocation(id: string): Promise<void> {
  check(await db().from('training_locations').delete().eq('id', id));
}

/** Upcoming slots (from the start of today), optionally for one trainer. */
export async function listSlots(trainerId?: string, days = 35): Promise<Slot[]> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86_400_000);
  let q = db().from('training_slots').select('*').gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at');
  if (trainerId) q = q.eq('trainer_id', trainerId);
  const rows = check(await q) as Slot[];
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
}

export async function addSlots(rows: { location_id: string; starts_at: string; price: number; note: string | null }[]): Promise<number> {
  if (!rows.length) return 0;
  // Skip hours the trainer already has (unique trainer + time).
  const res = check(await db().from('training_slots').upsert(rows, { onConflict: 'trainer_id,starts_at', ignoreDuplicates: true }).select('id')) as { id: string }[];
  return res.length;
}

export async function deleteSlot(id: string): Promise<void> {
  check(await db().from('training_slots').delete().eq('id', id));
}

export async function bookSlot(slotId: string, note: string): Promise<string> {
  return check(await db().rpc('book_slot', { s: slotId, note })) as string;
}

export async function cancelBooking(id: string): Promise<void> {
  check(await db().rpc('cancel_booking', { b: id }));
}

export async function myBookings(): Promise<Booking[]> {
  const s = await getSession();
  if (!s) return [];
  return check(await db().from('bookings').select('*').eq('player_id', s.user.id).eq('status', 'booked')) as Booking[];
}

export async function trainerBookings(): Promise<Booking[]> {
  const s = await getSession();
  if (!s) return [];
  return check(await db().from('bookings').select('*').eq('trainer_id', s.user.id).eq('status', 'booked')) as Booking[];
}

export async function myTrainees(): Promise<Map<string, { full_name: string; phone: string | null }>> {
  const rows = check(await db().rpc('my_trainees')) as { booking_id: string; full_name: string; phone: string | null }[];
  return new Map(rows.map((r) => [r.booking_id, r]));
}

/** Slots by id (used for "my bookings", which may be outside the listed window). */
export async function slotsById(ids: string[]): Promise<Slot[]> {
  if (!ids.length) return [];
  const rows = check(await db().from('training_slots').select('*').in('id', ids)) as Slot[];
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
}

/* -------------------------------------------------------- assistants */

export async function assistants(tournamentId: string): Promise<string[]> {
  const rows = check(await db().from('tournament_assistants').select('user_id').eq('tournament_id', tournamentId)) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export async function myAssignments(): Promise<string[]> {
  const s = await getSession();
  if (!s) return [];
  const rows = check(await db().from('tournament_assistants').select('tournament_id').eq('user_id', s.user.id)) as { tournament_id: string }[];
  return rows.map((r) => r.tournament_id);
}

export async function addAssistant(tournamentId: string, userId: string): Promise<void> {
  check(await db().from('tournament_assistants').insert({ tournament_id: tournamentId, user_id: userId }));
}

export async function removeAssistant(tournamentId: string, userId: string): Promise<void> {
  check(await db().from('tournament_assistants').delete().eq('tournament_id', tournamentId).eq('user_id', userId));
}

/* ------------------------------------------------------------- admin */

export type AdminCounts = Record<'users' | 'organizers' | 'sellers' | 'trainers' | 'tournaments' | 'running' | 'posts' | 'products' | 'pendingProducts' | 'pendingRoles' | 'orders' | 'bookings', number>;

export async function adminCounts(): Promise<AdminCounts | null> {
  return check(await db().rpc('admin_counts')) as AdminCounts | null;
}

/* ------------------------------------------------------------ images */

/** Shrink a photo in the browser and upload it to the public media bucket. Returns its URL. */
export async function uploadImage(file: File | Blob, maxSide = 1280): Promise<string> {
  const s = await getSession();
  if (!s) throw new Error('not signed in');
  const blob = await shrink(file, maxSide);
  const path = `${s.user.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const up = await db().storage.from('media').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(up.error.message);
  return db().storage.from('media').getPublicUrl(path).data.publicUrl;
}

/** A small square JPEG as a data URL (kept in the browser until the account can upload it). */
export async function squareDataUrl(file: File, side = 360): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, side, side);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg' });
}

async function shrink(file: File | Blob, maxSide: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('image'))), 'image/jpeg', 0.84));
}
