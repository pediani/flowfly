-- FlowFly: parcerias por convite, divisão de despesas e vínculo do Telegram
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run

begin;

-- =========================================================
-- 1. PARCERIAS (convite por e-mail)
-- =========================================================
create table if not exists public.partnerships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

-- Um único vínculo por par de usuários, em qualquer direção
create unique index if not exists partnerships_pair_uidx
  on public.partnerships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.partnerships enable row level security;

drop policy if exists "Ver proprias parcerias" on public.partnerships;
create policy "Ver proprias parcerias" on public.partnerships
  for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- Recusar, cancelar ou desfazer parceria
drop policy if exists "Remover proprias parcerias" on public.partnerships;
create policy "Remover proprias parcerias" on public.partnerships
  for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
-- Sem policy de insert/update: só pelas funções abaixo.

create or replace function public.invite_partner(p_email text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_other uuid;
  v_row public.partnerships%rowtype;
begin
  if v_me is null then raise exception 'Não autenticado'; end if;

  select id into v_other from auth.users where lower(email) = lower(trim(p_email));
  if v_other is null then raise exception 'Nenhum usuário cadastrado com esse e-mail'; end if;
  if v_other = v_me then raise exception 'Você não pode convidar a si mesmo'; end if;

  select * into v_row from public.partnerships
   where least(requester_id, addressee_id) = least(v_me, v_other)
     and greatest(requester_id, addressee_id) = greatest(v_me, v_other);

  if found then
    -- O outro já tinha me convidado: aceita direto
    if v_row.status = 'pending' and v_row.addressee_id = v_me then
      update public.partnerships set status = 'accepted' where id = v_row.id;
      return 'accepted';
    end if;
    raise exception 'Já existe um convite ou parceria com esse usuário';
  end if;

  insert into public.partnerships (requester_id, addressee_id) values (v_me, v_other);
  return 'pending';
end $$;

create or replace function public.accept_partner(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.partnerships set status = 'accepted'
   where id = p_id and addressee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Convite não encontrado'; end if;
end $$;

-- Lista parcerias com o e-mail do outro lado (auth.users não é acessível pelo client)
create or replace function public.list_partnerships()
returns table (id uuid, partner_id uuid, partner_email text, status text, incoming boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         case when p.requester_id = auth.uid() then p.addressee_id else p.requester_id end,
         u.email::text,
         p.status,
         p.addressee_id = auth.uid()
    from public.partnerships p
    join auth.users u
      on u.id = case when p.requester_id = auth.uid() then p.addressee_id else p.requester_id end
   where auth.uid() in (p.requester_id, p.addressee_id)
   order by p.created_at;
$$;

-- =========================================================
-- 2. DIVISÃO DE DESPESAS (grava as duas linhas de forma atômica)
-- =========================================================
create or replace function public.create_split_transaction(
  p_amount numeric, p_description text, p_category text, p_partner_id uuid
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_date date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id uuid;
begin
  if v_me is null then raise exception 'Não autenticado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor inválido'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Descrição obrigatória'; end if;

  if not exists (
    select 1 from public.partnerships
     where status = 'accepted'
       and ((requester_id = v_me and addressee_id = p_partner_id)
         or (requester_id = p_partner_id and addressee_id = v_me))
  ) then
    raise exception 'Parceiro inválido: é preciso uma parceria aceita';
  end if;

  insert into public.transactions (user_id, amount, description, type, category, is_split, date)
  values (v_me, p_amount, trim(p_description), 'saida', coalesce(p_category, 'Geral'), true, v_date)
  returning id into v_id;

  insert into public.transactions (user_id, amount, description, type, category, is_split, date)
  values (p_partner_id, round(p_amount / 2, 2), 'Metade: ' || trim(p_description), 'a_pagar',
          coalesce(p_category, 'Geral'), false, v_date);

  return v_id;
end $$;

-- =========================================================
-- 3. VÍNCULO DO TELEGRAM
-- =========================================================
-- Antes, qualquer usuário logado lia todos os vínculos. Agora só o próprio.
drop policy if exists "Permitir leitura de conexoes para usuarios logados" on public.telegram_connections;
drop policy if exists "Ler propria conexao" on public.telegram_connections;
drop policy if exists "Remover propria conexao" on public.telegram_connections;

create policy "Ler propria conexao" on public.telegram_connections
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Remover propria conexao" on public.telegram_connections
  for delete to authenticated using (user_id = (select auth.uid()));

-- Um chat por usuário e um usuário por chat
create unique index if not exists telegram_connections_chat_uidx on public.telegram_connections (telegram_chat_id);
create unique index if not exists telegram_connections_user_uidx on public.telegram_connections (user_id);

create table if not exists public.telegram_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
alter table public.telegram_link_codes enable row level security;
-- Sem policies: acesso só pelas funções.

-- Chamado pelo painel: gera um código de uso único, válido por 10 minutos
create or replace function public.create_telegram_link_code()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
begin
  if v_me is null then raise exception 'Não autenticado'; end if;
  delete from public.telegram_link_codes where user_id = v_me or expires_at < now();
  insert into public.telegram_link_codes (code, user_id) values (v_code, v_me);
  return v_code;
end $$;

-- Chamado só pelo webhook (service role): consome o código e grava o vínculo
create or replace function public.consume_telegram_link_code(p_code text, p_chat_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_user uuid;
begin
  delete from public.telegram_link_codes
   where code = upper(trim(p_code)) and expires_at > now()
  returning user_id into v_user;

  if v_user is null then return null; end if;

  delete from public.telegram_connections where telegram_chat_id = p_chat_id or user_id = v_user;
  insert into public.telegram_connections (telegram_chat_id, user_id) values (p_chat_id, v_user);
  return v_user;
end $$;

-- =========================================================
-- 4. PERMISSÕES DAS FUNÇÕES
-- =========================================================
revoke execute on function public.invite_partner(text)                                  from public, anon;
revoke execute on function public.accept_partner(uuid)                                  from public, anon;
revoke execute on function public.list_partnerships()                                   from public, anon;
revoke execute on function public.create_split_transaction(numeric, text, text, uuid)   from public, anon;
revoke execute on function public.create_telegram_link_code()                           from public, anon;
revoke execute on function public.consume_telegram_link_code(text, bigint)              from public, anon, authenticated;

grant execute on function public.invite_partner(text)                                to authenticated;
grant execute on function public.accept_partner(uuid)                                to authenticated;
grant execute on function public.list_partnerships()                                 to authenticated;
grant execute on function public.create_split_transaction(numeric, text, text, uuid) to authenticated;
grant execute on function public.create_telegram_link_code()                         to authenticated;
grant execute on function public.consume_telegram_link_code(text, bigint)            to service_role;

commit;
