alter table public.whiteboard_scenes
  add column if not exists delta_updated_at timestamptz;

create table if not exists public.whiteboard_scene_elements (
  user_id uuid not null references auth.users(id) on delete cascade,
  element_id text not null,
  element_order integer not null default 0,
  element jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, element_id)
);

alter table public.whiteboard_scene_elements
  add column if not exists element_order integer not null default 0;

create index if not exists whiteboard_scene_elements_user_order_idx
on public.whiteboard_scene_elements (user_id, element_order);

create table if not exists public.whiteboard_scene_files (
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id text not null,
  file jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

alter table public.whiteboard_scene_elements enable row level security;
alter table public.whiteboard_scene_files enable row level security;

drop policy if exists "Users can read their own whiteboard elements"
on public.whiteboard_scene_elements;

create policy "Users can read their own whiteboard elements"
on public.whiteboard_scene_elements
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own whiteboard elements"
on public.whiteboard_scene_elements;

create policy "Users can insert their own whiteboard elements"
on public.whiteboard_scene_elements
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own whiteboard elements"
on public.whiteboard_scene_elements;

create policy "Users can update their own whiteboard elements"
on public.whiteboard_scene_elements
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own whiteboard elements"
on public.whiteboard_scene_elements;

create policy "Users can delete their own whiteboard elements"
on public.whiteboard_scene_elements
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own whiteboard files"
on public.whiteboard_scene_files;

create policy "Users can read their own whiteboard files"
on public.whiteboard_scene_files
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own whiteboard files"
on public.whiteboard_scene_files;

create policy "Users can insert their own whiteboard files"
on public.whiteboard_scene_files
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own whiteboard files"
on public.whiteboard_scene_files;

create policy "Users can update their own whiteboard files"
on public.whiteboard_scene_files
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own whiteboard files"
on public.whiteboard_scene_files;

create policy "Users can delete their own whiteboard files"
on public.whiteboard_scene_files
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.whiteboard_scene_elements from anon;
revoke all on public.whiteboard_scene_files from anon;
grant select, insert, update, delete on public.whiteboard_scene_elements to authenticated;
grant select, insert, update, delete on public.whiteboard_scene_files to authenticated;

notify pgrst, 'reload schema';
