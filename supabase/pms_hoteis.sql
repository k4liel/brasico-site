-- =====================================================================
-- PMS dos hotéis (TOTVS Hospitalidade, "PMS SaaS"): ocupação e previsão
-- do Filha da Lua e do Sempre Vivo (Laif Hotelarias).
-- A Edge Function pms-extrair entra no PMS com o usuário do Vault, troca de
-- empresa (tenant) pela API e grava, para cada hotel:
--   pms_dias      = o painel do dia (ocupação, UHs, check-ins/outs), uma linha por hotel e dia
--   pms_previsao  = a disponibilidade dos próximos 60 dias, uma linha por hotel, dia e dia da leitura
-- Só números do hotel: nada de hóspede (nome, documento, contato) é copiado.
-- Quem vê: os sócios (notas_pode_ver). Nada se apaga.
--
-- Credenciais só no Vault (cadastradas por um sócio no SQL Editor; nunca aqui):
--   select vault.create_secret('<usuário do PMS>', 'pms_usuario');
--   select vault.create_secret('<senha do PMS>', 'pms_senha');
-- Para trocar: select vault.update_secret((select id from vault.secrets where name = 'pms_senha'), '<nova>');
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Hotéis lidos (id = o mesmo de public.hoteis). tenant_id é achado pelo robô pelo CNPJ.
create table if not exists public.pms_hoteis (
  id text primary key references public.hoteis(id),
  nome text not null,
  cnpj text not null,
  property_id int,
  tenant_id uuid,
  ativa boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.pms_hoteis (id, nome, cnpj, property_id, ordem) values
  ('filha-da-lua', 'Filha da Lua - Eco Lodge', '24021962000195', 475, 1),
  ('sempre-vivo', 'Sempre Vivo (Laif Hotelarias)', '50639716000101', 1504, 2)
on conflict (id) do nothing;

-- Cada leitura (todos os hotéis de uma vez)
create table if not exists public.pms_execucoes (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('agenda', 'site', 'claude')),
  pedido_por uuid references auth.users(id),
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'parcial', 'falha')),
  inicio timestamptz,
  fim timestamptz,
  erro text not null default '',
  resultado jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists pms_execucoes_idx on public.pms_execucoes (created_at desc);

-- Painel do dia (a última leitura do dia substitui a anterior)
create table if not exists public.pms_dias (
  hotel_id text not null references public.pms_hoteis(id),
  dia date not null,
  uhs int,
  ocupadas int,
  livres int,
  bloqueadas int,
  ocupacao numeric(6,2),
  ocupacao_prevista numeric(6,2),
  checkins int,
  checkouts int,
  checkins_previstos int,
  checkouts_previstos int,
  walk_in int,
  day_use int,
  painel jsonb not null default '{}',
  lido_em timestamptz not null default now(),
  execucao_id uuid references public.pms_execucoes(id),
  primary key (hotel_id, dia)
);
create index if not exists pms_dias_dia_idx on public.pms_dias (dia desc);

-- Previsão: para cada dia futuro, o que o PMS mostrava em cada dia de leitura (dá para ver o "pickup")
create table if not exists public.pms_previsao (
  hotel_id text not null references public.pms_hoteis(id),
  dia date not null,
  lido_dia date not null,
  uhs int,
  ocupadas int,
  disponiveis int,
  bloqueadas int,
  ocupacao numeric(6,2),
  individuais int,
  grupo int,
  confirmadas int,
  a_confirmar int,
  tentativas int,
  por_tipo jsonb not null default '[]',
  lido_em timestamptz not null default now(),
  execucao_id uuid references public.pms_execucoes(id),
  primary key (hotel_id, dia, lido_dia)
);
create index if not exists pms_previsao_dia_idx on public.pms_previsao (hotel_id, dia, lido_dia desc);

-- A previsão mais recente de cada dia
create or replace view public.pms_previsao_atual with (security_invoker = true) as
  select distinct on (hotel_id, dia) *
  from public.pms_previsao
  order by hotel_id, dia, lido_dia desc;

-- Exclusões bloqueadas, como no resto do Brasico
do $$
declare t text;
begin
  foreach t in array array['pms_hoteis', 'pms_execucoes', 'pms_dias', 'pms_previsao'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

alter table public.pms_hoteis enable row level security;
alter table public.pms_execucoes enable row level security;
alter table public.pms_dias enable row level security;
alter table public.pms_previsao enable row level security;

drop policy if exists "socios veem" on public.pms_hoteis;
create policy "socios veem" on public.pms_hoteis for select using (public.notas_pode_ver(auth.uid()));
drop policy if exists "socios veem" on public.pms_execucoes;
create policy "socios veem" on public.pms_execucoes for select using (public.notas_pode_ver(auth.uid()));
drop policy if exists "socios veem" on public.pms_dias;
create policy "socios veem" on public.pms_dias for select using (public.notas_pode_ver(auth.uid()));
drop policy if exists "socios veem" on public.pms_previsao;
create policy "socios veem" on public.pms_previsao for select using (public.notas_pode_ver(auth.uid()));

grant select on public.pms_hoteis, public.pms_execucoes, public.pms_dias, public.pms_previsao, public.pms_previsao_atual to authenticated;

-- ---------------------------------------------------------------------
-- Segredos. pms_segredo protege a Edge Function (gerado ao acaso aqui).
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'pms_segredo')
where not exists (select 1 from vault.secrets where name = 'pms_segredo');

create or replace function public.pms_conferir_segredo(p_segredo text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p_segredo, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'pms_segredo' and decrypted_secret = p_segredo)
$$;
revoke execute on function public.pms_conferir_segredo(text) from public, anon, authenticated;
grant execute on function public.pms_conferir_segredo(text) to service_role;

create or replace function public.pms_credenciais()
returns table (usuario text, senha text)
language sql stable security definer set search_path = public, vault as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'pms_usuario'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'pms_senha')
$$;
revoke execute on function public.pms_credenciais() from public, anon, authenticated;
grant execute on function public.pms_credenciais() to service_role;

-- ---------------------------------------------------------------------
-- Pedir uma leitura: registra e chama a Edge Function (pg_net).
-- Se já há uma na fila ou rodando (últimos 10 min), devolve essa.
-- ---------------------------------------------------------------------
create or replace function public.pms_pedir(p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select id into v_id from public.pms_execucoes
  where status in ('na_fila', 'rodando') and created_at > now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.pms_execucoes (origem, pedido_por) values (p_origem, p_user) returning id into v_id;
  perform net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/pms-extrair',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'pms_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.pms_pedir(text, uuid) from public, anon, authenticated;

-- Botão "Atualizar" do site (sócios)
create or replace function public.pms_atualizar()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso aos hotéis' using errcode = '42501'; end if;
  return public.pms_pedir('site', auth.uid());
end $$;
revoke execute on function public.pms_atualizar() from public, anon;
grant execute on function public.pms_atualizar() to authenticated;

-- Agenda: 7h, 13h e 23h30 de Fortaleza (a das 23h30 fecha o dia). Só roda com as credenciais no Vault.
create or replace function public.pms_agenda()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if not exists (select 1 from vault.secrets where name = 'pms_usuario')
     or not exists (select 1 from vault.secrets where name = 'pms_senha') then return; end if;
  perform public.pms_pedir('agenda', null);
end $$;
revoke execute on function public.pms_agenda() from public, anon, authenticated;

-- UTC = Fortaleza + 3 h: 10h e 16h UTC; 23h30 de Fortaleza = 2h30 UTC do dia seguinte
select cron.unschedule('pms-diario') where exists (select 1 from cron.job where jobname = 'pms-diario');
select cron.schedule('pms-diario', '0 10,16 * * *', $job$ select public.pms_agenda() $job$);
select cron.unschedule('pms-fecha-dia') where exists (select 1 from cron.job where jobname = 'pms-fecha-dia');
select cron.schedule('pms-fecha-dia', '30 2 * * *', $job$ select public.pms_agenda() $job$);
