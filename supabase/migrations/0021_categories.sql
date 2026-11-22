-- Admin-managed categories for the news, the Pingo Academy and the shop.
-- Posts and products keep storing a category key (text). Until now the keys were fixed
-- by check constraints; now they come from this table, which only an admin changes.
-- The old fixed categories are copied in with the same keys, so nothing that exists changes.
-- Product price is mandatory: new and edited products need a price above zero.

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  section     text not null check (section in ('news', 'academy', 'shop')),
  slug        text not null default ('c' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  icon        text not null default 'tag' check (char_length(icon) <= 20),
  blurb       text check (blurb is null or char_length(blurb) <= 120),
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (section, slug)
);

-- News and academy articles live in one table (posts), so their keys must not clash.
create unique index if not exists categories_post_slug on public.categories (slug) where section in ('news', 'academy');

alter table public.categories enable row level security;

drop policy if exists "categories: read" on public.categories;
create policy "categories: read" on public.categories for select using (true);
drop policy if exists "categories: admin writes" on public.categories;
create policy "categories: admin writes" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;

-- The categories that were fixed in the code, with their Arabic names.
insert into public.categories (section, slug, name, icon, blurb, sort) values
  ('news', 'news', 'أخبار', 'news', null, 0),
  ('news', 'events', 'فعاليات', 'calendar', null, 1),
  ('news', 'gear', 'أدوات', 'racket', null, 2),
  ('news', 'other', 'متنوع', 'spark', null, 3),
  ('academy', 'rules', 'القوانين', 'gavel', 'الإرسال، والعدّ، والزوجي', 0),
  ('academy', 'training', 'التدريب', 'target', 'تمارين وضربات خطوة بخطوة', 1),
  ('academy', 'tips', 'نصائح وحيل', 'bulb', 'أسرار صغيرة تكسب بها النقاط', 2),
  ('academy', 'learn', 'أساسيات', 'book', 'المضرب، والأدوات، والبداية', 3),
  ('shop', 'rackets', 'مضارب', 'racket', null, 0),
  ('shop', 'rubbers', 'كاوتش', 'grid', null, 1),
  ('shop', 'balls', 'كرات', 'ball', null, 2),
  ('shop', 'tables', 'طاولات', 'table', null, 3),
  ('shop', 'clothing', 'ملابس', 'user', null, 4),
  ('shop', 'shoes', 'أحذية', 'bolt', null, 5),
  ('shop', 'bags', 'حقائب', 'shop', null, 6),
  ('shop', 'accessories', 'إكسسوارات', 'tag', null, 7),
  ('shop', 'other', 'أخرى', 'box', null, 8)
on conflict (section, slug) do nothing;

-- The keys are no longer fixed lists.
alter table public.posts drop constraint if exists posts_category_check;
alter table public.products drop constraint if exists products_category_check;

-- A post or product must use a category from the admin's list.
create or replace function public.check_post_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.category is not distinct from old.category then return new; end if;
  if not exists (select 1 from public.categories where slug = new.category and section in ('news', 'academy')) then
    raise exception 'unknown category %', new.category using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_category_guard on public.posts;
create trigger posts_category_guard before insert or update on public.posts
  for each row execute function public.check_post_category();

create or replace function public.check_product_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Price is mandatory: a new product, or a changed price, must be above zero.
  -- (Products saved before this rule keep working until their price is edited.)
  if (tg_op = 'INSERT' or new.price is distinct from old.price) and (new.price is null or new.price <= 0) then
    raise exception 'price is required' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.category is not distinct from old.category then return new; end if;
  if not exists (select 1 from public.categories where slug = new.category and section = 'shop') then
    raise exception 'unknown category %', new.category using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists products_category_guard on public.products;
create trigger products_category_guard before insert or update on public.products
  for each row execute function public.check_product_category();

-- Delete a category; its articles or products move to another category first.
create or replace function public.delete_category(cat uuid, move_to uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.categories;
  dest public.categories;
  used integer;
begin
  if not public.is_admin() then raise exception 'only an admin can delete categories'; end if;
  select * into c from public.categories where id = cat;
  if not found then return; end if;
  if (select count(*) from public.categories where section = c.section) <= 1 then
    raise exception 'last category' using errcode = 'P0001', hint = 'keep at least one category';
  end if;
  if c.section = 'shop' then
    select count(*) into used from public.products where category = c.slug;
  else
    select count(*) into used from public.posts where category = c.slug;
  end if;
  if used > 0 then
    select * into dest from public.categories where id = move_to and id <> cat
      and (section = c.section or (section in ('news', 'academy') and c.section in ('news', 'academy')));
    if not found then raise exception 'pick a category to move % items to', used using errcode = 'P0001'; end if;
    if c.section = 'shop' then
      update public.products set category = dest.slug where category = c.slug;
    else
      update public.posts set category = dest.slug where category = c.slug;
    end if;
  end if;
  delete from public.categories where id = cat;
end;
$$;

-- Save a new order: the ids in the order they should show.
create or replace function public.reorder_categories(ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'only an admin can reorder categories'; end if;
  update public.categories c set sort = x.ord - 1
    from unnest(ids) with ordinality as x(id, ord) where c.id = x.id;
end;
$$;

revoke all on function public.delete_category(uuid, uuid) from public;
revoke all on function public.reorder_categories(uuid[]) from public;
grant execute on function public.delete_category(uuid, uuid) to authenticated;
grant execute on function public.reorder_categories(uuid[]) to authenticated;
