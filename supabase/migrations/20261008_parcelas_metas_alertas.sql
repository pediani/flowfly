-- FlowFly: parcelas, divisão vinculada, metas com prazo e alertas de orçamento
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run

begin;

-- 1. Lançamentos: vínculo da divisão e grupo de parcelas
alter table public.transactions
  add column if not exists split_parent_id uuid references public.transactions(id) on delete set null,
  add column if not exists installment_group uuid,
  add column if not exists installment_no int,
  add column if not exists installment_total int;

create index if not exists transactions_split_parent_idx on public.transactions (split_parent_id);
create index if not exists transactions_installment_group_idx on public.transactions (installment_group);

-- Ao excluir uma despesa dividida, remove a pendência do parceiro se ela ainda não foi paga
-- (se já foi paga, o registro dele fica intacto)
create or replace function public.remove_unpaid_split_children()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.transactions where split_parent_id = old.id and type = 'a_pagar';
  return old;
end $$;

drop trigger if exists transactions_remove_split_children on public.transactions;
create trigger transactions_remove_split_children
  before delete on public.transactions
  for each row when (old.is_split is true)
  execute function public.remove_unpaid_split_children();

-- Divisão agora guarda o lançamento de origem (permite acerto e desfazer em cascata)
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

  insert into public.transactions (user_id, amount, description, type, category, is_split, date, source)
  values (v_me, p_amount, trim(p_description), 'saida', coalesce(p_category, 'Geral'), true, v_date, 'web')
  returning id into v_id;

  insert into public.transactions (user_id, amount, description, type, category, is_split, date, source, split_parent_id)
  values (p_partner_id, round(p_amount / 2, 2), 'Metade: ' || trim(p_description), 'a_pagar',
          coalesce(p_category, 'Geral'), false, v_date, 'web', v_id);

  return v_id;
end $$;

-- Acerto com parceiro: quanto eu devo e quanto me devem (das divisões que eu fiz)
create or replace function public.partner_settlement()
returns table (i_owe numeric, owed_to_me numeric)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce((select sum(amount) from public.transactions where user_id = auth.uid() and type = 'a_pagar'), 0),
    coalesce((select sum(c.amount) from public.transactions c
               join public.transactions p on p.id = c.split_parent_id
              where p.user_id = auth.uid() and c.type = 'a_pagar'), 0);
$$;

revoke execute on function public.partner_settlement() from public, anon;
grant execute on function public.partner_settlement() to authenticated;

-- 2. Metas: prazo e data de criação
alter table public.goals
  add column if not exists deadline date,
  add column if not exists created_at timestamptz not null default now();
alter table public.goals alter column user_id set default auth.uid();
alter table public.goals alter column saved_amount set default 0;

-- 3. Alertas de orçamento já enviados (evita repetir todo dia)
create table if not exists public.budget_alerts (
  user_id  uuid not null references auth.users(id) on delete cascade,
  category text not null,
  month    text not null,
  level    int  not null, -- 80 ou 100
  sent_at  timestamptz not null default now(),
  primary key (user_id, category, month, level)
);
alter table public.budget_alerts enable row level security;
-- Sem policies: só o servidor (service role) acessa.

commit;
