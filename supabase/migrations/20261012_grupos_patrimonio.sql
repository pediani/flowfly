-- FlowFly: grupos de divisão (estilo Splitwise) e histórico de patrimônio
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run

begin;

-- ===== Grupos =====
create table if not exists public.split_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  archived   boolean not null default false
);

create table if not exists public.split_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.split_groups(id) on delete cascade,
  name       text not null,
  user_id    uuid references auth.users(id) on delete set null,  -- preenchido se a pessoa usa o FlowFly
  pix_key    text,
  created_at timestamptz not null default now()
);
create index if not exists split_members_group_idx on public.split_members (group_id);
create unique index if not exists split_members_user_uidx on public.split_members (group_id, user_id) where user_id is not null;

create table if not exists public.split_expenses (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.split_groups(id) on delete cascade,
  paid_by     uuid not null references public.split_members(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  description text not null,
  date        date not null default (now() at time zone 'America/Sao_Paulo')::date,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists split_expenses_group_idx on public.split_expenses (group_id, date desc);

create table if not exists public.split_shares (
  expense_id uuid not null references public.split_expenses(id) on delete cascade,
  member_id  uuid not null references public.split_members(id) on delete cascade,
  share      numeric(12,2) not null check (share >= 0),
  primary key (expense_id, member_id)
);

create table if not exists public.split_settlements (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.split_groups(id) on delete cascade,
  from_member uuid not null references public.split_members(id) on delete cascade,
  to_member   uuid not null references public.split_members(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  date        date not null default (now() at time zone 'America/Sao_Paulo')::date,
  created_at  timestamptz not null default now()
);

-- Quem pode ver/editar um grupo: o dono e os membros que usam o FlowFly
create or replace function public.can_access_group(p_group uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.split_groups g where g.id = p_group and g.owner_id = auth.uid())
      or exists (select 1 from public.split_members m where m.group_id = p_group and m.user_id = auth.uid());
$$;
revoke execute on function public.can_access_group(uuid) from public, anon;
grant execute on function public.can_access_group(uuid) to authenticated;

alter table public.split_groups enable row level security;
alter table public.split_members enable row level security;
alter table public.split_expenses enable row level security;
alter table public.split_shares enable row level security;
alter table public.split_settlements enable row level security;

drop policy if exists "grupos: ver" on public.split_groups;
create policy "grupos: ver" on public.split_groups for select to authenticated using (owner_id = (select auth.uid()) or public.can_access_group(id));
drop policy if exists "grupos: criar" on public.split_groups;
create policy "grupos: criar" on public.split_groups for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "grupos: dono altera" on public.split_groups;
create policy "grupos: dono altera" on public.split_groups for update to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "grupos: dono apaga" on public.split_groups;
create policy "grupos: dono apaga" on public.split_groups for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "membros: acesso" on public.split_members;
create policy "membros: acesso" on public.split_members for all to authenticated using (public.can_access_group(group_id)) with check (public.can_access_group(group_id));
drop policy if exists "despesas: acesso" on public.split_expenses;
create policy "despesas: acesso" on public.split_expenses for all to authenticated using (public.can_access_group(group_id)) with check (public.can_access_group(group_id));
drop policy if exists "partes: acesso" on public.split_shares;
create policy "partes: acesso" on public.split_shares for all to authenticated
  using (exists (select 1 from public.split_expenses e where e.id = expense_id and public.can_access_group(e.group_id)))
  with check (exists (select 1 from public.split_expenses e where e.id = expense_id and public.can_access_group(e.group_id)));
drop policy if exists "acertos: acesso" on public.split_settlements;
create policy "acertos: acesso" on public.split_settlements for all to authenticated using (public.can_access_group(group_id)) with check (public.can_access_group(group_id));

-- ===== Patrimônio (uma foto por mês, atualizada diariamente) =====
create table if not exists public.net_worth_snapshots (
  user_id     uuid not null references auth.users(id) on delete cascade,
  month       text not null,         -- YYYY-MM
  cash        numeric(14,2) not null default 0,
  investments numeric(14,2) not null default 0,
  debts       numeric(14,2) not null default 0,
  net         numeric(14,2) not null default 0,
  details     jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.net_worth_snapshots enable row level security;
drop policy if exists "patrimonio: ver" on public.net_worth_snapshots;
create policy "patrimonio: ver" on public.net_worth_snapshots for select to authenticated using (user_id = (select auth.uid()));

commit;
