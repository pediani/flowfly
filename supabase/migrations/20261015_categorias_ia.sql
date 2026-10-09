-- FlowFly: categorias por IA + aprendizado com as suas correções. Rodar uma vez no SQL Editor.

begin;

-- Quem definiu a categoria do lançamento: regra antiga (auto), IA, regra aprendida ou você
alter table public.transactions add column if not exists category_by text;
alter table public.transactions drop constraint if exists transactions_category_by_check;
alter table public.transactions add constraint transactions_category_by_check
  check (category_by is null or category_by in ('auto', 'ai', 'rule', 'user'));

-- Quando você troca a categoria de um estabelecimento, o app lembra para os próximos
create table if not exists public.category_rules (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant   text not null,
  category   text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, merchant)
);
alter table public.category_rules enable row level security;

drop policy if exists "Regras próprias" on public.category_rules;
create policy "Regras próprias" on public.category_rules
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

commit;
