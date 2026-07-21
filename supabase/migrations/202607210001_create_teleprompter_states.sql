create table if not exists public.teleprompter_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  scripts jsonb not null default '[""]'::jsonb,
  active_script_index integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.set_teleprompter_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_teleprompter_state_updated_at on public.teleprompter_states;
create trigger set_teleprompter_state_updated_at
before update on public.teleprompter_states
for each row
execute function public.set_teleprompter_state_updated_at();

alter table public.teleprompter_states enable row level security;

drop policy if exists "Subscribed users can read their own teleprompter state" on public.teleprompter_states;
create policy "Subscribed users can read their own teleprompter state"
on public.teleprompter_states
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

drop policy if exists "Subscribed users can insert their own teleprompter state" on public.teleprompter_states;
create policy "Subscribed users can insert their own teleprompter state"
on public.teleprompter_states
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

drop policy if exists "Subscribed users can update their own teleprompter state" on public.teleprompter_states;
create policy "Subscribed users can update their own teleprompter state"
on public.teleprompter_states
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

revoke all on public.teleprompter_states from anon;
grant select, insert, update on public.teleprompter_states to authenticated;

notify pgrst, 'reload schema';
