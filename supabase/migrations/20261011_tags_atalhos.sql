-- FlowFly: tags de evento (@viagem) e tokens para atalhos (Siri / Android)
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run

begin;

alter table public.transactions add column if not exists tags text[];
create index if not exists transactions_tags_idx on public.transactions using gin (tags);

create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text,
  token_hash   text not null unique,   -- sha-256 do token (o token em si só aparece uma vez)
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.api_tokens enable row level security;
drop policy if exists "Ver proprios tokens" on public.api_tokens;
create policy "Ver proprios tokens" on public.api_tokens for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Apagar proprios tokens" on public.api_tokens;
create policy "Apagar proprios tokens" on public.api_tokens for delete to authenticated using (user_id = (select auth.uid()));

commit;
