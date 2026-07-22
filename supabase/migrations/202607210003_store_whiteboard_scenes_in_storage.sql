alter table public.whiteboard_scenes
  add column if not exists storage_path text,
  add column if not exists storage_size bigint,
  add column if not exists storage_updated_at timestamptz;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'whiteboard-scenes',
  'whiteboard-scenes',
  false,
  104857600,
  array['application/json', 'application/octet-stream']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own whiteboard scene files"
on storage.objects;

create policy "Users can read their own whiteboard scene files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'whiteboard-scenes'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can insert their own whiteboard scene files"
on storage.objects;

create policy "Users can insert their own whiteboard scene files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'whiteboard-scenes'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can update their own whiteboard scene files"
on storage.objects;

create policy "Users can update their own whiteboard scene files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'whiteboard-scenes'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'whiteboard-scenes'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete their own whiteboard scene files"
on storage.objects;

create policy "Users can delete their own whiteboard scene files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'whiteboard-scenes'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

notify pgrst, 'reload schema';
