-- FlowFly: hora/origem dos lançamentos e orçamento por categoria
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run
-- (o aviso de "destructive operations" aparece só por causa dos "drop policy if exists")

begin;

-- 1. Hora da inclusão e origem (painel ou Telegram)
-- Adicionada sem default primeiro: lançamentos antigos ficam sem hora (null) em vez de receber a hora desta migration.
alter table public.transactions add column if not exists created_at timestamptz;
alter table public.transactions alter column created_at set default now();

alter table public.transactions add column if not exists source text;
alter table public.transactions alter column source set default 'web';
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source is null or source in ('web', 'telegram'));

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc, created_at desc);

-- 2. Orçamento mensal por categoria
create table if not exists public.budgets (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category      text not null,
  monthly_limit numeric(12,2) not null check (monthly_limit > 0),
  updated_at    timestamptz not null default now(),
  primary key (user_id, category)
);

alter table public.budgets enable row level security;

drop policy if exists "Acesso proprio orcamentos" on public.budgets;
create policy "Acesso proprio orcamentos" on public.budgets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
