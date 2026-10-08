-- FlowFly: dia de fechamento e vencimento de cada cartão, definidos por você
-- (quando o banco informa errado ou não informa). Rodar uma vez no SQL Editor.

begin;

create table if not exists public.card_settings (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id text not null,                                  -- id da conta do cartão na Pluggy
  close_day  int check (close_day between 1 and 31),
  due_day    int check (due_day between 1 and 31),
  updated_at timestamptz not null default now(),
  primary key (user_id, account_id)
);
alter table public.card_settings enable row level security;

drop policy if exists "Cartões próprios" on public.card_settings;
create policy "Cartões próprios" on public.card_settings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

commit;
