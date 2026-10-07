-- FlowFly: integração com bancos via Pluggy (Meu Pluggy / Open Finance)
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run

begin;

-- 1. Conexões bancárias (um "item" da Pluggy por banco)
create table if not exists public.bank_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id       text not null unique,
  institution   text,
  status        text,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.bank_connections enable row level security;

drop policy if exists "Ver proprias conexoes bancarias" on public.bank_connections;
create policy "Ver proprias conexoes bancarias" on public.bank_connections
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Remover proprias conexoes bancarias" on public.bank_connections;
create policy "Remover proprias conexoes bancarias" on public.bank_connections
  for delete to authenticated using (user_id = (select auth.uid()));
-- Inclusão só pelo servidor, que valida o item na Pluggy antes de gravar.

-- 2. Lançamentos vindos do banco
alter table public.transactions
  add column if not exists external_id text,       -- id da transação na Pluggy
  add column if not exists bank_description text,   -- descrição original do extrato
  add column if not exists bank_account text;       -- ex.: "Itaú · Cartão"

create unique index if not exists transactions_external_id_uidx
  on public.transactions (external_id) where external_id is not null;

-- 'bank' como origem e 'ignorado' para lançamentos do banco descartados (não reimporta)
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source is null or source in ('web', 'telegram', 'bank'));

commit;
