create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lifetime boolean not null default false,
  paid_at timestamptz,
  payment_provider text,
  payment_reference text,
  updated_at timestamptz not null default now()
);

create unique index if not exists user_entitlements_payment_reference_key
on public.user_entitlements (payment_reference)
where payment_reference is not null;

alter table public.user_entitlements enable row level security;

drop policy if exists "Users can read their own entitlement" on public.user_entitlements;
create policy "Users can read their own entitlement"
on public.user_entitlements
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.user_entitlements from anon, authenticated;
grant select on public.user_entitlements to authenticated;
