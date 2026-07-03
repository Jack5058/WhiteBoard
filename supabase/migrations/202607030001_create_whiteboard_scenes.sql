create table if not exists public.whiteboard_scenes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  elements jsonb not null default '[]'::jsonb,
  app_state jsonb not null default '{}'::jsonb,
  files jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_whiteboard_scene_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_whiteboard_scene_updated_at on public.whiteboard_scenes;
create trigger set_whiteboard_scene_updated_at
before update on public.whiteboard_scenes
for each row
execute function public.set_whiteboard_scene_updated_at();

alter table public.whiteboard_scenes enable row level security;

drop policy if exists "Users can read their own whiteboard scene" on public.whiteboard_scenes;
create policy "Users can read their own whiteboard scene"
on public.whiteboard_scenes
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own whiteboard scene" on public.whiteboard_scenes;
create policy "Users can insert their own whiteboard scene"
on public.whiteboard_scenes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own whiteboard scene" on public.whiteboard_scenes;
create policy "Users can update their own whiteboard scene"
on public.whiteboard_scenes
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own whiteboard scene" on public.whiteboard_scenes;
create policy "Users can delete their own whiteboard scene"
on public.whiteboard_scenes
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.whiteboard_scenes from anon;
grant select, insert, update, delete on public.whiteboard_scenes to authenticated;

notify pgrst, 'reload schema';
