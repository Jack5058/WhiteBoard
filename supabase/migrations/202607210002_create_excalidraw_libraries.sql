create table if not exists public.excalidraw_libraries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  library_items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_excalidraw_library_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_excalidraw_library_updated_at on public.excalidraw_libraries;
create trigger set_excalidraw_library_updated_at
before update on public.excalidraw_libraries
for each row
execute function public.set_excalidraw_library_updated_at();

alter table public.excalidraw_libraries enable row level security;

drop policy if exists "Subscribed users can read their own library" on public.excalidraw_libraries;
create policy "Subscribed users can read their own library"
on public.excalidraw_libraries
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_entitlements entitlement
    where entitlement.user_id = (select auth.uid())
      and entitlement.lifetime = true
  )
);

drop policy if exists "Subscribed users can insert their own library" on public.excalidraw_libraries;
create policy "Subscribed users can insert their own library"
on public.excalidraw_libraries
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_entitlements entitlement
    where entitlement.user_id = (select auth.uid())
      and entitlement.lifetime = true
  )
);

drop policy if exists "Subscribed users can update their own library" on public.excalidraw_libraries;
create policy "Subscribed users can update their own library"
on public.excalidraw_libraries
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_entitlements entitlement
    where entitlement.user_id = (select auth.uid())
      and entitlement.lifetime = true
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_entitlements entitlement
    where entitlement.user_id = (select auth.uid())
      and entitlement.lifetime = true
  )
);

revoke all on public.excalidraw_libraries from anon;
grant select, insert, update on public.excalidraw_libraries to authenticated;

notify pgrst, 'reload schema';
