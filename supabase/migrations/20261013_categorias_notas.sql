-- FlowFly: categorias personalizadas e observação nos lançamentos
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run

begin;

-- Observação própria (não sobrescreve a descrição que veio do banco)
alter table public.transactions add column if not exists note text;

-- Categorias criadas pelo usuário (a tabela já existia, sem uso)
alter table public.categories alter column id set default gen_random_uuid();
alter table public.categories alter column user_id set default auth.uid();
alter table public.categories
  add column if not exists emoji text,
  add column if not exists color text,
  add column if not exists icon text,
  add column if not exists keywords text[],
  add column if not exists created_at timestamptz not null default now();
create unique index if not exists categories_user_name_uidx on public.categories (user_id, lower(name));

alter table public.categories enable row level security;
drop policy if exists "Categorias proprias" on public.categories;
create policy "Categorias proprias" on public.categories
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

commit;
