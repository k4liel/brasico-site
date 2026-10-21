-- =====================================================================
-- TOTVS Chef: vendas do dia de cada unidade (lojas do cliente no Chef Web).
-- A Edge Function totvs-extrair consulta a Chef Web API (vendas, sangrias e
-- fechamento de caixa) e grava um resumo por unidade e dia em totvs_dias.
-- Todo dia às 6h (Fortaleza) a agenda puxa o dia anterior de cada unidade.
-- Quem vê: só quem está em totvs_acesso (os sócios), no site e no conector.
--
-- Unidades e credenciais são cadastradas direto no banco, nunca neste arquivo
-- (o repositório é público):
--   insert into public.totvs_unidades (id, nome, loja, chave, ordem)
--     values ('<id>', '<nome>', <código da loja>, '<CentralNumber ou SerialNumber>', 1);
--   select vault.create_secret('<usuário>', 'totvs_usuario');
--   select vault.create_secret('<senha>', 'totvs_senha');
--   select vault.create_secret('<número serial>', 'totvs_serial_<id da unidade>');
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.totvs_acesso (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
-- Começa com os mesmos sócios do WhatsApp
insert into public.totvs_acesso (user_id) select user_id from public.wa_acesso on conflict do nothing;

-- Unidade sem loja (código TOTVS) fica sem extração: nunca usa a loja de outra unidade
create table if not exists public.totvs_unidades (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  nome text not null,
  loja int,
  chave text check (chave in ('CentralNumber', 'SerialNumber')),
  ativa boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

-- Um registro por unidade e dia operacional (data de movimento). Reprocessar o dia substitui o registro.
create table if not exists public.totvs_dias (
  unidade_id text not null references public.totvs_unidades(id),
  dia date not null,
  status text not null check (status in ('ok', 'revisar', 'sem_movimento')),
  vendas int not null default 0,
  pessoas int not null default 0,
  total numeric(14, 2) not null default 0,
  resumo jsonb not null default '{}',
  produtos jsonb not null default '[]',
  pagamentos jsonb not null default '[]',
  garcons jsonb not null default '[]',
  sangrias jsonb not null default '[]',
  fechamentos jsonb not null default '[]',
  cancelados jsonb not null default '[]',
  divergencias jsonb not null default '[]',
  execucao_id uuid,
  atualizado_em timestamptz not null default now(),
  primary key (unidade_id, dia)
);
create index if not exists totvs_dias_dia_idx on public.totvs_dias (dia desc);

-- Cada extração (pedida pela agenda, pelo site ou pelo Claude), com o resultado
create table if not exists public.totvs_execucoes (
  id uuid primary key default gen_random_uuid(),
  unidade_id text not null references public.totvs_unidades(id),
  dia date not null,
  origem text not null check (origem in ('agenda', 'site', 'claude')),
  pedido_por uuid references auth.users(id),
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'revisar', 'sem_movimento', 'falha')),
  inicio timestamptz,
  fim timestamptz,
  tentativas int not null default 0,
  endpoints jsonb not null default '[]',
  erro text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists totvs_execucoes_idx on public.totvs_execucoes (unidade_id, dia, created_at desc);

-- Exclusões bloqueadas, como no resto do Brasico
do $$
declare t text;
begin
  foreach t in array array['totvs_acesso', 'totvs_unidades', 'totvs_dias', 'totvs_execucoes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

create or replace function public.totvs_pode_ver(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.totvs_acesso where user_id = p_user)
$$;
revoke execute on function public.totvs_pode_ver(uuid) from public, anon;
grant execute on function public.totvs_pode_ver(uuid) to authenticated;

alter table public.totvs_acesso enable row level security;
alter table public.totvs_unidades enable row level security;
alter table public.totvs_dias enable row level security;
alter table public.totvs_execucoes enable row level security;

drop policy if exists "ver acesso" on public.totvs_acesso;
create policy "ver acesso" on public.totvs_acesso for select using (user_id = auth.uid());
drop policy if exists "ver unidades" on public.totvs_unidades;
create policy "ver unidades" on public.totvs_unidades for select using (public.totvs_pode_ver(auth.uid()));
drop policy if exists "ver dias" on public.totvs_dias;
create policy "ver dias" on public.totvs_dias for select using (public.totvs_pode_ver(auth.uid()));
drop policy if exists "ver execucoes" on public.totvs_execucoes;
create policy "ver execucoes" on public.totvs_execucoes for select using (public.totvs_pode_ver(auth.uid()));

revoke all on public.totvs_acesso, public.totvs_unidades, public.totvs_dias, public.totvs_execucoes from anon;
grant select on public.totvs_acesso, public.totvs_unidades, public.totvs_dias, public.totvs_execucoes to authenticated;

do $$ begin alter publication supabase_realtime add table public.totvs_execucoes; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.totvs_dias; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Segredos (Vault). totvs_segredo protege a Edge Function e é gerado ao acaso aqui.
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'totvs_segredo')
where not exists (select 1 from vault.secrets where name = 'totvs_segredo');

create or replace function public.totvs_conferir_segredo(p_segredo text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p_segredo, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'totvs_segredo' and decrypted_secret = p_segredo)
$$;
revoke execute on function public.totvs_conferir_segredo(text) from public, anon, authenticated;
grant execute on function public.totvs_conferir_segredo(text) to service_role;

-- Credenciais de uma unidade (só a Edge Function, com service_role)
create or replace function public.totvs_credenciais(p_unidade text)
returns table (usuario text, senha text, serial text, chave text, loja int)
language sql stable security definer set search_path = public, vault as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_usuario'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_senha'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_serial_' || u.id),
         u.chave, u.loja
  from public.totvs_unidades u where u.id = p_unidade
$$;
revoke execute on function public.totvs_credenciais(text) from public, anon, authenticated;
grant execute on function public.totvs_credenciais(text) to service_role;

-- ---------------------------------------------------------------------
-- Pedir uma extração: registra na fila e chama a Edge Function (pg_net).
-- Se a mesma unidade e dia já estão na fila ou rodando, devolve essa.
-- ---------------------------------------------------------------------
create or replace function public.totvs_pedir(p_unidade text, p_dia date, p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare u public.totvs_unidades; v_id uuid; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  select * into u from public.totvs_unidades where id = p_unidade;
  if u.id is null then raise exception 'Unidade "%" não encontrada.', p_unidade; end if;
  if not u.ativa or u.loja is null then
    raise exception 'A unidade % não tem loja TOTVS configurada; não dá para extrair.', u.nome;
  end if;
  if p_dia is null or p_dia > v_hoje then raise exception 'Escolha um dia até hoje.'; end if;
  if p_dia < v_hoje - 400 then raise exception 'Dia antigo demais (máximo de 400 dias atrás).'; end if;

  select id into v_id from public.totvs_execucoes
  where unidade_id = u.id and dia = p_dia and status in ('na_fila', 'rodando') and created_at > now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.totvs_execucoes (unidade_id, dia, origem, pedido_por)
  values (u.id, p_dia, p_origem, p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/totvs-extrair',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.totvs_pedir(text, date, text, uuid) from public, anon, authenticated;

-- Botão "Atualizar" do site
create or replace function public.totvs_extrair(p_unidade text, p_dia date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.totvs_pode_ver(auth.uid()) then raise exception 'Sem acesso às vendas TOTVS' using errcode = '42501'; end if;
  return public.totvs_pedir(p_unidade, p_dia, 'site', auth.uid());
end $$;
revoke execute on function public.totvs_extrair(text, date) from public, anon;
grant execute on function public.totvs_extrair(text, date) to authenticated;

-- Agenda diária: o dia anterior de cada unidade e, de novo, dias que falharam na última semana
create or replace function public.totvs_agenda()
returns void language plpgsql security definer set search_path = public as $$
declare u record; d date; v_ontem date := (now() at time zone 'America/Fortaleza')::date - 1;
begin
  for u in select id from public.totvs_unidades where ativa and loja is not null order by ordem loop
    perform public.totvs_pedir(u.id, v_ontem, 'agenda', null);
    for d in
      select distinct e.dia from public.totvs_execucoes e
      where e.unidade_id = u.id and e.dia between v_ontem - 7 and v_ontem - 1 and e.status = 'falha'
        and not exists (select 1 from public.totvs_dias t where t.unidade_id = u.id and t.dia = e.dia)
    loop
      perform public.totvs_pedir(u.id, d, 'agenda', null);
    end loop;
  end loop;
end $$;
revoke execute on function public.totvs_agenda() from public, anon, authenticated;

-- 6h em Fortaleza (UTC-3) = 9h UTC
select cron.unschedule('totvs-diario') where exists (select 1 from cron.job where jobname = 'totvs-diario');
select cron.schedule('totvs-diario', '0 9 * * *', $job$ select public.totvs_agenda() $job$);

-- ---------------------------------------------------------------------
-- Conector (ferramentas totvs_* do Claude)
-- ---------------------------------------------------------------------
create or replace function public.mcp_totvs_auth(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.totvs_pode_ver(a.o_user) then
    raise exception 'Sem acesso às vendas TOTVS' using errcode = '42501';
  end if;
  return a.o_user;
end $$;
revoke execute on function public.mcp_totvs_auth(text) from public, anon, authenticated;

-- Acha a unidade pelo id ou por parte do nome
create or replace function public.totvs_achar_unidade(p_unidade text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text; n int;
begin
  select id into v from public.totvs_unidades where id = lower(trim(p_unidade));
  if v is not null then return v; end if;
  select count(*), min(id) into n, v from public.totvs_unidades where nome ilike '%' || trim(p_unidade) || '%';
  if n = 0 then raise exception 'Unidade "%" não encontrada. Veja os nomes em totvs_unidades.', p_unidade; end if;
  if n > 1 then raise exception 'Mais de uma unidade com "%" no nome. Use o id de totvs_unidades.', p_unidade; end if;
  return v;
end $$;
revoke execute on function public.totvs_achar_unidade(text) from public, anon, authenticated;

create or replace function public.mcp_totvs_unidades(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.mcp_totvs_auth(p_token);
  return jsonb_build_object('hoje', (now() at time zone 'America/Fortaleza')::date, 'unidades', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'nome', u.nome, 'loja', u.loja, 'extrai', u.ativa and u.loja is not null,
      'ultimo_dia_extraido', (select max(dia) from public.totvs_dias d where d.unidade_id = u.id),
      'ultimas_execucoes', (select coalesce(jsonb_agg(jsonb_build_object('dia', e.dia, 'status', e.status, 'origem', e.origem,
          'quando', to_char(e.created_at at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'), 'erro', nullif(e.erro, ''))
          order by e.created_at desc), '[]'::jsonb)
        from (select * from public.totvs_execucoes x where x.unidade_id = u.id order by x.created_at desc limit 5) e)
    ) order by u.ordem, u.nome)
    from public.totvs_unidades u), '[]'::jsonb));
end $$;

create or replace function public.mcp_totvs_vendas(p_token text, p_unidade text default null, p_de date default null,
  p_ate date default null, p_detalhe boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_unidade text; v_de date; v_ate date; v_detalhe boolean;
begin
  perform public.mcp_totvs_auth(p_token);
  if p_unidade is not null then v_unidade := public.totvs_achar_unidade(p_unidade); end if;
  v_ate := coalesce(p_ate, (now() at time zone 'America/Fortaleza')::date - 1);
  v_de := coalesce(p_de, v_ate);
  if v_ate - v_de > 92 then raise exception 'Período longo demais (máximo de 93 dias).'; end if;
  v_detalhe := coalesce(p_detalhe, v_ate - v_de <= 1);
  return jsonb_build_object('de', v_de, 'ate', v_ate, 'dias', coalesce((
    select jsonb_agg(
      jsonb_build_object('unidade', u.nome, 'unidade_id', u.id, 'dia', d.dia, 'status', d.status,
        'vendas', d.vendas, 'pessoas', d.pessoas, 'total', d.total, 'resumo', d.resumo, 'divergencias', d.divergencias,
        'atualizado_em', to_char(d.atualizado_em at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'))
      || case when v_detalhe then jsonb_build_object('produtos', d.produtos, 'pagamentos', d.pagamentos,
           'garcons', d.garcons, 'sangrias', d.sangrias, 'fechamentos', d.fechamentos, 'cancelados', d.cancelados)
         else '{}'::jsonb end
      order by d.dia desc, u.ordem)
    from public.totvs_dias d join public.totvs_unidades u on u.id = d.unidade_id
    where d.dia between v_de and v_ate and (v_unidade is null or d.unidade_id = v_unidade)), '[]'::jsonb));
end $$;

create or replace function public.mcp_totvs_extrair(p_token text, p_unidade text, p_dia date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_unidade text; v_id uuid;
begin
  v_user := public.mcp_totvs_auth(p_token);
  v_unidade := public.totvs_achar_unidade(p_unidade);
  v_id := public.totvs_pedir(v_unidade, p_dia, 'claude', v_user);
  return jsonb_build_object('execucao', v_id, 'unidade', v_unidade, 'dia', p_dia,
    'aviso', 'Extração pedida. Leva de alguns segundos a 1 minuto; veja o resultado em totvs_unidades (ultimas_execucoes) e depois em totvs_vendas.');
end $$;

revoke execute on function public.mcp_totvs_unidades(text) from public, authenticated;
revoke execute on function public.mcp_totvs_vendas(text, text, date, date, boolean) from public, authenticated;
revoke execute on function public.mcp_totvs_extrair(text, text, date) from public, authenticated;
grant execute on function public.mcp_totvs_unidades(text) to anon;
grant execute on function public.mcp_totvs_vendas(text, text, date, date, boolean) to anon;
grant execute on function public.mcp_totvs_extrair(text, text, date) to anon;
