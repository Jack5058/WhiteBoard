create table if not exists public.payment_orders (
  out_trade_no text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  amount_cents integer not null,
  currency text not null default 'CNY',
  status text not null default 'created',
  trade_no text,
  buyer_id text,
  raw_notify jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_orders_user_id_idx
on public.payment_orders (user_id);

create unique index if not exists payment_orders_trade_no_key
on public.payment_orders (trade_no)
where trade_no is not null;

alter table public.payment_orders enable row level security;

revoke all on public.payment_orders from anon, authenticated;
