-- Public image bucket for news covers, product photos and trainer pictures.
-- Each signed-in user uploads only into a folder named after their own id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media: users upload to own folder" on storage.objects;
create policy "media: users upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media: users replace own files" on storage.objects;
create policy "media: users replace own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and owner = auth.uid());

drop policy if exists "media: users delete own files" on storage.objects;
create policy "media: users delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and owner = auth.uid());
