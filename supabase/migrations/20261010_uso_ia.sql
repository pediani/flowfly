-- FlowFly: registro de uso da IA (Groq) para monitoramento no painel
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run

begin;

create table if not exists public.ai_usage (
  id                 bigint generated always as identity primary key,
  user_id            uuid references auth.users(id) on delete cascade,
  created_at         timestamptz not null default now(),
  provider           text not null,            -- 'groq' | 'local' (resolvido sem IA)
  kind               text not null,            -- 'chat' | 'audio' | 'local'
  model              text,
  purpose            text,                     -- 'texto livre' | 'áudio' | ...
  status             text not null,            -- 'ok' | 'erro' | 'sem resultado'
  http_status        int,
  latency_ms         int,
  prompt_tokens      int,
  completion_tokens  int,
  cached_tokens      int,
  reasoning_tokens   int,
  total_tokens       int,
  audio_seconds      numeric(10,2),
  queue_time_ms      int,
  server_time_ms     int,
  result_count       int,
  input_chars        int,
  request_id         text,
  ratelimit          jsonb,                    -- headers x-ratelimit-* da resposta
  error              text
);

create index if not exists ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
drop policy if exists "Ver proprio uso de IA" on public.ai_usage;
create policy "Ver proprio uso de IA" on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));
-- Inclusão só pelo servidor (service role).

commit;
