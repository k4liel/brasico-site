-- =====================================================================
-- RHiD (ponto em nuvem da Control iD), somente leitura. Fase 1: cadastros.
-- A Edge Function rhid-extrair entra na API oficial (https://www.rhid.com.br/v2/api.svc,
-- documentação em /v2/swagger.svc) e copia empresas, departamentos, cargos, relógios e
-- pessoas de cada cliente RHiD que o login enxerga (um login pode ter vários clientes,
-- cada um com seu domínio). Todo dia às 5h (Fortaleza) a agenda atualiza tudo.
-- Quem vê: só quem está em rhid_acesso (os sócios).
--
-- Nunca copiamos senha do funcionário, crachá (RFID), código de barras, digitais nem foto.
--
-- E-mail e senha do usuário do RHiD ficam só no Vault, cadastrados por um sócio
-- direto no SQL Editor do Supabase, nunca neste arquivo nem no chat:
--   select vault.create_secret('<e-mail do usuário do RHiD>', 'rhid_email');
--   select vault.create_secret('<senha do usuário do RHiD>', 'rhid_senha');
-- Trocar a senha:
--   select vault.update_secret((select id from vault.secrets where name = 'rhid_senha'), '<nova senha>');
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.rhid_acesso (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
-- Começa com os mesmos sócios do eSocial
insert into public.rhid_acesso (user_id) select user_id from public.esocial_acesso on conflict do nothing;

-- Clientes RHiD que o login enxerga (aprendidos no login). ativo = false deixa de copiar.
create table if not exists public.rhid_clientes (
  id bigint primary key,
  dominio text not null default '',
  nome text not null default '',
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.rhid_empresas (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  cnpj text not null default '',
  nome text not null default '',
  fantasia text not null default '',
  cidade text not null default '',
  uf text not null default '',
  pessoas int,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);

create table if not exists public.rhid_departamentos (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  nome text not null default '',
  empresa_id bigint,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);

create table if not exists public.rhid_cargos (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  nome text not null default '',
  empresa_id bigint,
  departamento_id bigint,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);

create table if not exists public.rhid_relogios (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  nome text not null default '',
  serial text not null default '',
  modelo text not null default '',
  versao text not null default '',
  situacao text not null default '',
  empresa_id bigint,
  pessoas int,
  ultima_conexao timestamptz,
  ultima_sincronizacao timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);

-- presente = false: a pessoa estava no RHiD e não veio na última cópia (nada se apaga)
create table if not exists public.rhid_pessoas (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  nome text not null default '',
  nome_social text not null default '',
  cpf text not null default '',
  pis text not null default '',
  matricula text not null default '',
  empresa_id bigint,
  departamento_id bigint,
  situacao int,
  admissao date,
  presente boolean not null default true,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);
create index if not exists rhid_pessoas_cpf on public.rhid_pessoas (cpf);

-- Cada cópia (pedida pela agenda, pelo site ou pelo Claude), com o resultado
create table if not exists public.rhid_execucoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'cadastros' check (tipo in ('cadastros')),
  origem text not null check (origem in ('agenda', 'site', 'claude')),
  pedido_por uuid references auth.users(id),
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'falha')),
  inicio timestamptz,
  fim timestamptz,
  resumo jsonb not null default '{}',
  erro text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists rhid_execucoes_quando on public.rhid_execucoes (created_at desc);

-- Exclusões bloqueadas, como no resto do Brasico
do $$
declare t text;
begin
  foreach t in array array['rhid_acesso', 'rhid_clientes', 'rhid_empresas', 'rhid_departamentos', 'rhid_cargos',
                           'rhid_relogios', 'rhid_pessoas', 'rhid_execucoes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

create or replace function public.rhid_pode_ver(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rhid_acesso where user_id = p_user)
$$;
revoke execute on function public.rhid_pode_ver(uuid) from public, anon;
grant execute on function public.rhid_pode_ver(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['rhid_clientes', 'rhid_empresas', 'rhid_departamentos', 'rhid_cargos',
                           'rhid_relogios', 'rhid_pessoas', 'rhid_execucoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.rhid_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.rhid_acesso enable row level security;
drop policy if exists "ver acesso" on public.rhid_acesso;
create policy "ver acesso" on public.rhid_acesso for select using (user_id = auth.uid());
revoke all on public.rhid_acesso from anon;
grant select on public.rhid_acesso to authenticated;

-- ---------------------------------------------------------------------
-- Segredos (Vault). rhid_segredo protege a Edge Function e é gerado ao acaso aqui.
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'rhid_segredo')
where not exists (select 1 from vault.secrets where name = 'rhid_segredo');

create or replace function public.rhid_conferir_segredo(p_segredo text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p_segredo, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'rhid_segredo' and decrypted_secret = p_segredo)
$$;
revoke execute on function public.rhid_conferir_segredo(text) from public, anon, authenticated;
grant execute on function public.rhid_conferir_segredo(text) to service_role;

-- E-mail e senha do RHiD (só a Edge Function, com service_role)
create or replace function public.rhid_credenciais()
returns table (email text, senha text)
language sql stable security definer set search_path = public, vault as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'rhid_email'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'rhid_senha')
$$;
revoke execute on function public.rhid_credenciais() from public, anon, authenticated;
grant execute on function public.rhid_credenciais() to service_role;

-- ---------------------------------------------------------------------
-- Pedir uma cópia: registra na fila e chama a Edge Function (pg_net).
-- Se já há uma na fila ou rodando há menos de 10 min, devolve essa.
-- ---------------------------------------------------------------------
create or replace function public.rhid_pedir(p_tipo text, p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select id into v_id from public.rhid_execucoes
  where tipo = p_tipo and status in ('na_fila', 'rodando') and created_at > now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.rhid_execucoes (tipo, origem, pedido_por) values (p_tipo, p_origem, p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/rhid-extrair',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'rhid_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.rhid_pedir(text, text, uuid) from public, anon, authenticated;

-- Botão "Atualizar" do site
create or replace function public.rhid_atualizar()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Sem acesso ao ponto (RHiD)' using errcode = '42501'; end if;
  return public.rhid_pedir('cadastros', 'site', auth.uid());
end $$;
revoke execute on function public.rhid_atualizar() from public, anon;
grant execute on function public.rhid_atualizar() to authenticated;

-- Agenda diária: só roda depois que o e-mail e a senha estão no Vault
create or replace function public.rhid_agenda()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if (select count(*) from vault.secrets where name in ('rhid_email', 'rhid_senha')) < 2 then return; end if;
  perform public.rhid_pedir('cadastros', 'agenda', null);
end $$;
revoke execute on function public.rhid_agenda() from public, anon, authenticated;

select cron.unschedule('rhid-diario') where exists (select 1 from cron.job where jobname = 'rhid-diario');
select cron.schedule('rhid-diario', '0 8 * * *', $job$ select public.rhid_agenda() $job$);

-- =====================================================================
-- Fase 2: batidas do ponto, lidas do AFD (Portaria 671) de cada relógio.
-- Cada relógio vira uma fonte de AFD; o REP-P (app e navegador) de cada empresa
-- também, com o id da empresa + 99000000, como a API pede.
-- Leitura nova: a partir do último NSR guardado (nsr_ultimo), nos últimos 90 dias.
-- Histórico: a cada leitura, mais uma janela de 90 dias para trás por relógio
-- (historico_ate), até 2 janelas seguidas sem batida (historico_fim).
-- Agenda rhid-batidas: todo dia às 5h10 de Fortaleza, depois dos cadastros.
-- =====================================================================

alter table public.rhid_relogios add column if not exists nsr_ultimo bigint;
alter table public.rhid_relogios add column if not exists historico_ate date;
alter table public.rhid_relogios add column if not exists historico_vazias int not null default 0;
alter table public.rhid_relogios add column if not exists historico_fim boolean not null default false;
alter table public.rhid_relogios add column if not exists rep_p boolean not null default false;

-- Uma linha por batida (relógio + NSR). Ler de novo substitui, sem duplicar.
create table if not exists public.rhid_batidas (
  cliente_id bigint not null references public.rhid_clientes(id),
  relogio_id bigint not null,
  nsr bigint not null,
  momento timestamptz not null,
  cpf text not null default '',
  pis text not null default '',
  pessoa_id bigint,
  tipo_registro text not null default '',
  online boolean,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, relogio_id, nsr)
);
create index if not exists rhid_batidas_momento on public.rhid_batidas (momento desc);
create index if not exists rhid_batidas_pessoa on public.rhid_batidas (cliente_id, pessoa_id, momento);

alter table public.rhid_execucoes drop constraint if exists rhid_execucoes_tipo_check;
alter table public.rhid_execucoes add constraint rhid_execucoes_tipo_check check (tipo in ('cadastros', 'batidas'));

do $$
begin
  drop trigger if exists rhid_batidas_sem_exclusao on public.rhid_batidas;
  create trigger rhid_batidas_sem_exclusao before delete on public.rhid_batidas for each row execute function public.bloquear_exclusao();
  drop trigger if exists rhid_batidas_sem_truncate on public.rhid_batidas;
  create trigger rhid_batidas_sem_truncate before truncate on public.rhid_batidas for each statement execute function public.bloquear_exclusao();
end $$;

alter table public.rhid_batidas enable row level security;
drop policy if exists "ver" on public.rhid_batidas;
create policy "ver" on public.rhid_batidas for select using (public.rhid_pode_ver(auth.uid()));
revoke all on public.rhid_batidas from anon;
grant select on public.rhid_batidas to authenticated;

-- Agenda das batidas: só roda depois que o e-mail e a senha estão no Vault
create or replace function public.rhid_agenda_batidas()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if (select count(*) from vault.secrets where name in ('rhid_email', 'rhid_senha')) < 2 then return; end if;
  perform public.rhid_pedir('batidas', 'agenda', null);
end $$;
revoke execute on function public.rhid_agenda_batidas() from public, anon, authenticated;

select cron.unschedule('rhid-batidas') where exists (select 1 from cron.job where jobname = 'rhid-batidas');
select cron.schedule('rhid-batidas', '10 8 * * *', $job$ select public.rhid_agenda_batidas() $job$);

-- =====================================================================
-- Fase 2 (revista): o AFD é recusado (403) para o usuário do Brasico; as batidas e as contas do dia
-- vêm da apuração do ponto (/apuracao_ponto), uma linha por pessoa e dia em rhid_dias.
-- rhid_batidas fica sem uso enquanto o AFD estiver bloqueado.
-- =====================================================================
create table if not exists public.rhid_dias (
  cliente_id bigint not null references public.rhid_clientes(id),
  pessoa_id bigint not null,
  dia date not null,
  horario text not null default '',
  folga boolean not null default false,
  feriado boolean not null default false,
  falta boolean not null default false,
  justificado boolean not null default false,
  pendencia boolean not null default false,
  minutos_trabalhados int not null default 0,
  minutos_extra int not null default 0,
  minutos_extra_noturna int not null default 0,
  minutos_atraso int not null default 0,
  minutos_saida_antecipada int not null default 0,
  minutos_falta int not null default 0,
  minutos_abono int not null default 0,
  saldo_banco int,
  alerta text not null default '',
  batidas jsonb not null default '[]',
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, pessoa_id, dia)
);
create index if not exists rhid_dias_dia on public.rhid_dias (dia desc);

alter table public.rhid_pessoas add column if not exists apuracao_em timestamptz;
alter table public.rhid_pessoas add column if not exists historico_ate date;
alter table public.rhid_pessoas add column if not exists historico_fim boolean not null default false;

do $$
begin
  drop trigger if exists rhid_dias_sem_exclusao on public.rhid_dias;
  create trigger rhid_dias_sem_exclusao before delete on public.rhid_dias for each row execute function public.bloquear_exclusao();
  drop trigger if exists rhid_dias_sem_truncate on public.rhid_dias;
  create trigger rhid_dias_sem_truncate before truncate on public.rhid_dias for each statement execute function public.bloquear_exclusao();
end $$;

alter table public.rhid_dias enable row level security;
drop policy if exists "ver" on public.rhid_dias;
create policy "ver" on public.rhid_dias for select using (public.rhid_pode_ver(auth.uid()));
revoke all on public.rhid_dias from anon;
grant select on public.rhid_dias to authenticated;
do $$ begin alter publication supabase_realtime add table public.rhid_execucoes; exception when duplicate_object then null; end $$;

-- Ponto: de 10 em 10 min das 5h às 7h50 (Fortaleza) termina o que faltar; de novo às 12h e 17h
select cron.unschedule('rhid-batidas') where exists (select 1 from cron.job where jobname = 'rhid-batidas');
select cron.schedule('rhid-batidas', '*/10 8-10 * * *', $job$ select public.rhid_agenda_batidas() $job$);
select cron.unschedule('rhid-batidas-dia') where exists (select 1 from cron.job where jobname = 'rhid-batidas-dia');
select cron.schedule('rhid-batidas-dia', '0 15,20 * * *', $job$ select public.rhid_agenda_batidas() $job$);

-- =====================================================================
-- Ponto × RH (eSocial): o ponto alimenta o cadastro do RH e economiza acessos ao eSocial.
-- rhid_sincronizar_rh (de hora em hora):
--  * quem está ativo no RHiD, com CPF, e falta no cadastro da empresa (mesma raiz de CNPJ) entra em
--    esocial_trabalhadores com origem 'ponto' (unidade = departamento do RHiD, admissão do RHiD);
--  * cada trabalhador recebe a situação no ponto: 'batendo' (bateu nos últimos 3 dias), 'parou'
--    (ativo no RHiD e sem batida há mais de 7 dias), 'inativo' (inativo no RHiD), 'sem_ponto' (CPF fora do RHiD).
-- esocial_proximo usa isso na releitura (passo de quem já foi lido): quem está 'batendo' é relido a cada
-- 7 dias em vez de 2; quem 'parou' ou ficou 'inativo' no ponto vem primeiro (provável afastamento ou saída).
-- Os outros passos (S-1299, primeira leitura, histórico, download) não mudam.
-- =====================================================================
alter table public.esocial_trabalhadores add column if not exists ponto_situacao text not null default '';
alter table public.esocial_trabalhadores add column if not exists ponto_ultima_batida date;
alter table public.esocial_trabalhadores add column if not exists ponto_atualizado_em timestamptz;
alter table public.esocial_trabalhadores drop constraint if exists esocial_trabalhadores_origem_check;
alter table public.esocial_trabalhadores add constraint esocial_trabalhadores_origem_check check (origem in ('manual', 'evento', 'ponto'));

create or replace function public.rhid_sincronizar_rh()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_novos int; v_marcados int; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  create temp table _ponto on commit drop as
  select distinct on (left(e.cnpj, 8), p.cpf)
    left(e.cnpj, 8) raiz, p.cpf, p.nome, p.matricula, p.admissao, p.situacao, coalesce(d.nome, '') depto,
    (select max(x.dia) from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id
       and jsonb_array_length(x.batidas) > 0) ultima
  from public.rhid_pessoas p
  join public.rhid_empresas e on e.cliente_id = p.cliente_id and e.id = p.empresa_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  where p.presente and length(p.cpf) = 11 and length(e.cnpj) = 14
  order by left(e.cnpj, 8), p.cpf, p.situacao desc nulls last, p.admissao desc nulls last;

  insert into public.esocial_trabalhadores (empresa_id, cpf, nome, matricula, admissao, unidade, origem)
  select x.raiz, x.cpf, x.nome, x.matricula, x.admissao, x.depto, 'ponto'
  from _ponto x
  where x.situacao = 1 and exists (select 1 from public.esocial_empresas e where e.id = x.raiz)
  on conflict do nothing;
  get diagnostics v_novos = row_count;

  update public.esocial_trabalhadores t set
    ponto_situacao = case
      when x.cpf is null then 'sem_ponto'
      when x.situacao is distinct from 1 then 'inativo'
      when x.ultima >= v_hoje - 3 then 'batendo'
      when x.ultima is null or x.ultima < v_hoje - 7 then 'parou'
      else 'batendo' end,
    ponto_ultima_batida = x.ultima,
    ponto_atualizado_em = now()
  from public.esocial_trabalhadores t2
  left join _ponto x on x.raiz = t2.empresa_id and x.cpf = t2.cpf
  where t.empresa_id = t2.empresa_id and t.cpf = t2.cpf;
  get diagnostics v_marcados = row_count;
  return jsonb_build_object('novos', v_novos, 'marcados', v_marcados);
end $$;
revoke execute on function public.rhid_sincronizar_rh() from public, anon, authenticated;

select cron.unschedule('rhid-rh') where exists (select 1 from cron.job where jobname = 'rhid-rh');
select cron.schedule('rhid-rh', '25 * * * *', $job$ select public.rhid_sincronizar_rh() $job$);

-- esocial_proximo: só o passo da releitura muda (intervalo e ordem); o resto da função fica igual
do $$
declare v_def text := pg_get_functiondef('public.esocial_proximo(text)'::regprocedure);
begin
  if position('ponto_situacao' in v_def) = 0 then
    v_def := replace(v_def,
      $a$where t.empresa_id = e.id and t.ativo and t.consultado_ate < now() - interval '2 days'$a$,
      $b$where t.empresa_id = e.id and t.ativo
      and t.consultado_ate < now() - case when t.ponto_situacao = 'batendo' then interval '7 days' else interval '2 days' end$b$);
    v_def := replace(v_def,
      $a$order by t.consultado_ate limit 1;$a$,
      $b$order by (t.ponto_situacao in ('parou', 'inativo')) desc, t.consultado_ate limit 1;$b$);
    if position('ponto_situacao' in v_def) = 0 then raise exception 'esocial_proximo mudou: revise a troca'; end if;
    execute v_def;
  end if;
end $$;

-- Botão "Atualizar" da seção Ponto do RH
create or replace function public.rhid_atualizar_ponto()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Sem acesso ao ponto (RHiD)' using errcode = '42501'; end if;
  return public.rhid_pedir('batidas', 'site', auth.uid());
end $$;
revoke execute on function public.rhid_atualizar_ponto() from public, anon;
grant execute on function public.rhid_atualizar_ponto() to authenticated;
create extension if not exists unaccent with schema extensions;

-- =====================================================================
-- Conector (Claude): ferramentas rhid_* só de leitura. Mesmo desenho do TOTVS (mcp_totvs_*):
-- o link do Claude é validado por mcp_auth e o usuário precisa estar em rhid_acesso.
-- Toda leitura de dados de pessoas fica registrada em esocial_consultas (LGPD, art. 37),
-- e aparece na área técnica do RH.
-- =====================================================================
create or replace function public.mcp_rhid_auth(p_token text, p_ferramenta text, p_parametros jsonb default '{}', p_quantidade int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.rhid_pode_ver(a.o_user) then
    raise exception 'Sem acesso ao ponto (RHiD)' using errcode = '42501';
  end if;
  insert into public.esocial_consultas (user_id, origem, ferramenta, parametros, quantidade)
  values (a.o_user, 'claude', p_ferramenta, coalesce(p_parametros, '{}'), coalesce(p_quantidade, 0));
  return a.o_user;
end $$;
revoke execute on function public.mcp_rhid_auth(text, text, jsonb, int) from public, anon, authenticated;

-- Empresa do RH (raiz do CNPJ) de uma pessoa do RHiD
create or replace function public.rhid_raiz(p_cliente bigint, p_empresa bigint)
returns text language sql stable security definer set search_path = public as $$
  select left(e.cnpj, 8) from public.rhid_empresas e where e.cliente_id = p_cliente and e.id = p_empresa
$$;
revoke execute on function public.rhid_raiz(bigint, bigint) from public, anon, authenticated;

-- Acha pessoas do relógio pelo nome (parte), CPF ou id "cliente:id"
create or replace function public.rhid_achar_pessoas(p_busca text)
returns table (cliente_id bigint, id bigint) language sql stable security definer set search_path = public as $$
  select p.cliente_id, p.id from public.rhid_pessoas p
  where p.presente and (
    (p_busca ~ '^\d+:\d+$' and p.cliente_id = split_part(p_busca, ':', 1)::bigint and p.id = split_part(p_busca, ':', 2)::bigint)
    or (regexp_replace(p_busca, '\D', '', 'g') ~ '^\d{11}$' and p.cpf = regexp_replace(p_busca, '\D', '', 'g'))
    or (p_busca !~ '^\d+:\d+$' and regexp_replace(p_busca, '\D', '', 'g') !~ '^\d{11}$' and unaccent(p.nome) ilike '%' || unaccent(trim(p_busca)) || '%')
  )
$$;
revoke execute on function public.rhid_achar_pessoas(text) from public, anon, authenticated;

-- Situação geral: clientes, relógios, última leitura, quantas pessoas e dias lidos
create or replace function public.mcp_rhid_situacao(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  perform public.mcp_rhid_auth(p_token, 'rhid_situacao');
  return jsonb_build_object(
    'hoje', v_hoje,
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'ativo', c.ativo,
        'empresas', (select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cnpj', e.cnpj, 'raiz_rh', left(e.cnpj, 8))) from public.rhid_empresas e where e.cliente_id = c.id),
        'pessoas_ativas', (select count(*) from public.rhid_pessoas p where p.cliente_id = c.id and p.situacao = 1 and p.presente and (p.cpf <> '' or exists (select 1 from public.rhid_dias d where d.cliente_id = p.cliente_id and d.pessoa_id = p.id))),
        'pessoas_sem_cpf', (select count(*) from public.rhid_pessoas p where p.cliente_id = c.id and p.situacao = 1 and p.presente and p.cpf = ''),
        'relogios', (select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome, 'ultima_conexao', to_char(r.ultima_conexao at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'),
            'conectado_24h', r.ultima_conexao > now() - interval '24 hours') order by r.id) from public.rhid_relogios r where r.cliente_id = c.id and not r.rep_p),
        'dias_lidos_de', (select min(dia) from public.rhid_dias d where d.cliente_id = c.id),
        'dias_lidos_ate', (select max(dia) from public.rhid_dias d where d.cliente_id = c.id)
      ) order by c.nome) from public.rhid_clientes c), '[]'::jsonb),
    'ultimas_leituras', coalesce((select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'status', x.status, 'origem', x.origem,
        'quando', to_char(x.created_at at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'), 'erro', nullif(x.erro, ''), 'resumo', x.resumo) order by x.created_at desc)
      from (select * from public.rhid_execucoes order by created_at desc limit 6) x), '[]'::jsonb),
    'agenda', 'Cadastros às 5h; ponto a cada 10 min das 5h às 7h50 e às 12h e 17h (Fortaleza). Dias futuros trazem a escala prevista.');
end $$;

-- Equipe do relógio: pessoas ativas, unidade (departamento), situação no ponto e saldo do banco
create or replace function public.mcp_rhid_equipe(p_token text, p_busca text default null, p_unidade text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.cliente_id || ':' || p.id, 'nome', p.nome, 'cpf', p.cpf, 'matricula', p.matricula, 'admissao', p.admissao,
      'cliente', c.nome, 'empresa_rh', public.rhid_raiz(p.cliente_id, p.empresa_id), 'unidade', coalesce(d.nome, ''),
      'ultima_batida', u.ultima, 'escala_hoje', nullif(regexp_replace(h.horario, E'\\r?\\n', ' / ', 'g'), ''),
      'saldo_banco_min', s.saldo, 'saldo_banco', case when s.saldo is null then null else
        (case when s.saldo < 0 then '-' else '+' end) || (abs(s.saldo) / 60) || 'h' || lpad((abs(s.saldo) % 60)::text, 2, '0') end,
      'no_rh', exists (select 1 from public.esocial_trabalhadores t where t.cpf = p.cpf and t.empresa_id = public.rhid_raiz(p.cliente_id, p.empresa_id))
    ) order by c.nome, d.nome, p.nome), '[]'::jsonb) into v
  from public.rhid_pessoas p
  join public.rhid_clientes c on c.id = p.cliente_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  left join lateral (select max(x.dia) ultima from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and jsonb_array_length(x.batidas) > 0) u on true
  left join lateral (select x.saldo_banco saldo from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.saldo_banco is not null and x.dia <= v_hoje order by x.dia desc limit 1) s on true
  left join lateral (select x.horario from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.dia = v_hoje) h on true
  where p.situacao = 1 and p.presente and (p.cpf <> '' or u.ultima is not null)
    and (p_busca is null or (p.cliente_id, p.id) in (select a.cliente_id, a.id from public.rhid_achar_pessoas(p_busca) a))
    and (p_unidade is null or unaccent(coalesce(d.nome, '')) ilike '%' || unaccent(p_unidade) || '%');
  perform public.mcp_rhid_auth(p_token, 'rhid_equipe', jsonb_strip_nulls(jsonb_build_object('busca', p_busca, 'unidade', p_unidade)), jsonb_array_length(v));
  return jsonb_build_object('hoje', v_hoje, 'pessoas', v);
end $$;

-- Ponto de uma pessoa (ou de uma unidade) num período: por dia, escala, batidas, horas, faltas, atrasos, saldo
create or replace function public.mcp_rhid_ponto(p_token text, p_pessoa text default null, p_unidade text default null, p_de date default null, p_ate date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; v_de date; v_ate date; v jsonb;
begin
  if p_pessoa is null and p_unidade is null then raise exception 'Informe a pessoa (nome, CPF ou id) ou a unidade.'; end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_de := coalesce(p_de, v_ate - 6);
  if v_ate - v_de > 92 then raise exception 'Período longo demais (máximo de 93 dias).'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'pessoa', p.nome, 'id', p.cliente_id || ':' || p.id, 'unidade', coalesce(d.nome, ''),
      'dias', (select jsonb_agg(jsonb_build_object(
          'dia', x.dia, 'escala', nullif(regexp_replace(x.horario, E'\\r?\\n', ' / ', 'g'), ''),
          'folga', x.folga or (x.horario = '' and not x.feriado), 'feriado', x.feriado,
          'batidas', (select coalesce(jsonb_agg(b->>'hora'), '[]'::jsonb) from jsonb_array_elements(x.batidas) b),
          'trabalhou_min', x.minutos_trabalhados, 'extra_min', x.minutos_extra, 'atraso_min', x.minutos_atraso,
          'saida_antecipada_min', x.minutos_saida_antecipada, 'falta', x.falta, 'falta_justificada', x.falta and x.justificado,
          'abono_min', x.minutos_abono, 'saldo_banco_min', x.saldo_banco, 'alerta', nullif(x.alerta, ''))
          order by x.dia)
        from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.dia between v_de and v_ate),
      'totais', (select jsonb_build_object('trabalhou_min', sum(x.minutos_trabalhados), 'extra_min', sum(x.minutos_extra),
          'atraso_min', sum(x.minutos_atraso), 'faltas', count(*) filter (where x.falta and not x.justificado),
          'faltas_justificadas', count(*) filter (where x.falta and x.justificado), 'dias_trabalhados', count(*) filter (where x.minutos_trabalhados > 0))
        from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.dia between v_de and least(v_ate, v_hoje - 1))
    ) order by d.nome, p.nome), '[]'::jsonb) into v
  from public.rhid_pessoas p
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  where p.situacao = 1 and p.presente
    and (p_pessoa is null or (p.cliente_id, p.id) in (select a.cliente_id, a.id from public.rhid_achar_pessoas(p_pessoa) a))
    and (p_unidade is null or unaccent(coalesce(d.nome, '')) ilike '%' || unaccent(p_unidade) || '%');
  perform public.mcp_rhid_auth(p_token, 'rhid_ponto', jsonb_strip_nulls(jsonb_build_object('pessoa', p_pessoa, 'unidade', p_unidade, 'de', v_de, 'ate', v_ate)), jsonb_array_length(v));
  return jsonb_build_object('de', v_de, 'ate', v_ate, 'hoje', v_hoje, 'minutos', 'todos os tempos estão em minutos', 'pessoas', v);
end $$;

-- Banco de horas de todo mundo: saldo atual e variação em 30 dias, por unidade
create or replace function public.mcp_rhid_banco_horas(p_token text, p_unidade text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'pessoa', p.nome, 'id', p.cliente_id || ':' || p.id, 'unidade', coalesce(d.nome, ''), 'cliente', c.nome,
      'saldo_min', s.saldo, 'saldo', (case when s.saldo < 0 then '-' else '+' end) || (abs(s.saldo) / 60) || 'h' || lpad((abs(s.saldo) % 60)::text, 2, '0'),
      'saldo_em', s.dia, 'variacao_30_dias_min', s.saldo - a.saldo
    ) order by s.saldo), '[]'::jsonb) into v
  from public.rhid_pessoas p
  join public.rhid_clientes c on c.id = p.cliente_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  join lateral (select x.saldo_banco saldo, x.dia from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.saldo_banco is not null and x.dia <= v_hoje order by x.dia desc limit 1) s on true
  left join lateral (select x.saldo_banco saldo from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.saldo_banco is not null and x.dia <= v_hoje - 30 order by x.dia desc limit 1) a on true
  where p.situacao = 1 and p.presente
    and (p_unidade is null or unaccent(coalesce(d.nome, '')) ilike '%' || unaccent(p_unidade) || '%');
  perform public.mcp_rhid_auth(p_token, 'rhid_banco_horas', jsonb_strip_nulls(jsonb_build_object('unidade', p_unidade)), jsonb_array_length(v));
  return jsonb_build_object('hoje', v_hoje,
    'total_positivo_min', (select coalesce(sum((e->>'saldo_min')::int), 0) from jsonb_array_elements(v) e where (e->>'saldo_min')::int > 0),
    'total_negativo_min', (select coalesce(sum((e->>'saldo_min')::int), 0) from jsonb_array_elements(v) e where (e->>'saldo_min')::int < 0),
    'pessoas', v);
end $$;

-- Pedir uma leitura agora (cadastros ou ponto)
create or replace function public.mcp_rhid_atualizar(p_token text, p_tipo text default 'batidas')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_id uuid;
begin
  v_user := public.mcp_rhid_auth(p_token, 'rhid_atualizar', jsonb_build_object('tipo', p_tipo));
  if p_tipo not in ('cadastros', 'batidas') then raise exception 'Tipo deve ser "cadastros" ou "batidas".'; end if;
  v_id := public.rhid_pedir(p_tipo, 'claude', v_user);
  return jsonb_build_object('execucao', v_id, 'tipo', p_tipo,
    'aviso', 'Leitura pedida. Leva de alguns segundos a 2 minutos; veja o resultado em rhid_situacao (ultimas_leituras).');
end $$;

revoke execute on function public.mcp_rhid_situacao(text) from public, authenticated;
revoke execute on function public.mcp_rhid_equipe(text, text, text) from public, authenticated;
revoke execute on function public.mcp_rhid_ponto(text, text, text, date, date) from public, authenticated;
revoke execute on function public.mcp_rhid_banco_horas(text, text) from public, authenticated;
revoke execute on function public.mcp_rhid_atualizar(text, text) from public, authenticated;
grant execute on function public.mcp_rhid_situacao(text) to anon;
grant execute on function public.mcp_rhid_equipe(text, text, text) to anon;
grant execute on function public.mcp_rhid_ponto(text, text, text, date, date) to anon;
grant execute on function public.mcp_rhid_banco_horas(text, text) to anon;
grant execute on function public.mcp_rhid_atualizar(text, text) to anon;

-- ---------------------------------------------------------------------
-- Cadastros completos (out/2026). O site do RHiD usa uma API interna (`/v2/customerdb/<tabela>.svc/<ação>`,
-- mesmo token do login) cujas LISTAS funcionam: pessoas com cargo, centro de custo, demissão e nº da folha;
-- cargos; centros de custo (o local de verdade: Cicchetti Centro, Filha da Lua, Sempre Vivo); escalas com o
-- horário contratual; tipos de justificativa. A ficha completa (person.svc/a/<id>) traz a escala vigente.
-- Continua tudo só leitura. Nada de e-mail, telefone, endereço, foto, crachá ou senha: não se copia.
-- ---------------------------------------------------------------------
create table if not exists public.rhid_centros_custo (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  nome text not null default '',
  empresa_id bigint,
  pessoas int,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);

-- dias: [{dia: 0..6 (ou posição no ciclo), horas: ["06:20","12:00","13:00","14:40"], minutos: 500}]
create table if not exists public.rhid_escalas (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  nome text not null default '',
  tipo text not null default '',
  ciclo int,
  horario text not null default '',
  cor text not null default '',
  pessoas int,
  dias jsonb not null default '[]',
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);

create table if not exists public.rhid_justificativa_tipos (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  nome text not null default '',
  abreviacao text not null default '',
  tipo int,
  abona_falta boolean,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);

alter table public.rhid_pessoas
  add column if not exists cargo_id bigint,
  add column if not exists centro_custo_id bigint,
  add column if not exists escala_id bigint,
  add column if not exists escala_desde date,
  add column if not exists demissao date,
  add column if not exists numero_folha text not null default '';

do $$
declare t text;
begin
  foreach t in array array['rhid_centros_custo', 'rhid_escalas', 'rhid_justificativa_tipos'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.rhid_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Ponto × RH: o centro de custo do RHiD vira a unidade do RH e o cargo do RHiD preenche quem está sem cargo
create or replace function public.rhid_sincronizar_rh()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_novos int; v_marcados int; v_completados int; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  create temp table _ponto on commit drop as
  select distinct on (left(e.cnpj, 8), p.cpf)
    left(e.cnpj, 8) raiz, p.cpf, p.nome, p.matricula, p.admissao, p.situacao,
    case when cc.nome ~* 'cicchetti' then 'CICCHETTI' when cc.nome ~* 'filha da lua' then 'FDL' when cc.nome ~* 'sempre vivo' then 'SV'
         when d.nome ~* '\(CC\)' then 'CICCHETTI' when d.nome ~* '\(FDL\)' then 'FDL' when d.nome ~* '\(SV\)' then 'SV'
         when left(e.cnpj, 8) = '36528542' then 'Genesis' else coalesce(d.nome, '') end depto,
    coalesce(cg.nome, '') cargo,
    (select max(x.dia) from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id
       and jsonb_array_length(x.batidas) > 0) ultima
  from public.rhid_pessoas p
  join public.rhid_empresas e on e.cliente_id = p.cliente_id and e.id = p.empresa_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  left join public.rhid_centros_custo cc on cc.cliente_id = p.cliente_id and cc.id = p.centro_custo_id
  left join public.rhid_cargos cg on cg.cliente_id = p.cliente_id and cg.id = p.cargo_id
  where p.presente and length(p.cpf) = 11 and length(e.cnpj) = 14
  order by left(e.cnpj, 8), p.cpf, p.situacao desc nulls last, p.admissao desc nulls last;

  insert into public.esocial_trabalhadores (empresa_id, cpf, nome, matricula, admissao, unidade, cargo, origem)
  select x.raiz, x.cpf, x.nome, x.matricula, x.admissao, x.depto, x.cargo, 'ponto'
  from _ponto x
  where x.situacao = 1 and exists (select 1 from public.esocial_empresas e where e.id = x.raiz)
  on conflict do nothing;
  get diagnostics v_novos = row_count;

  -- Só completa o que está vazio: o que veio do contador ou do eSocial não se sobrescreve
  update public.esocial_trabalhadores t set
    cargo = case when coalesce(t.cargo, '') = '' then x.cargo else t.cargo end,
    unidade = case when coalesce(t.unidade, '') = '' then x.depto else t.unidade end,
    admissao = coalesce(t.admissao, x.admissao)
  from _ponto x
  where x.raiz = t.empresa_id and x.cpf = t.cpf
    and ((coalesce(t.cargo, '') = '' and x.cargo <> '') or (coalesce(t.unidade, '') = '' and x.depto <> '') or (t.admissao is null and x.admissao is not null));
  get diagnostics v_completados = row_count;

  update public.esocial_trabalhadores t set
    ponto_situacao = case
      when x.cpf is null then 'sem_ponto'
      when x.situacao is distinct from 1 then 'inativo'
      when x.ultima >= v_hoje - 3 then 'batendo'
      when x.ultima is null or x.ultima < v_hoje - 7 then 'parou'
      else 'batendo' end,
    ponto_ultima_batida = x.ultima,
    ponto_atualizado_em = now()
  from public.esocial_trabalhadores t2
  left join _ponto x on x.raiz = t2.empresa_id and x.cpf = t2.cpf
  where t.empresa_id = t2.empresa_id and t.cpf = t2.cpf;
  get diagnostics v_marcados = row_count;
  return jsonb_build_object('novos', v_novos, 'completados', v_completados, 'marcados', v_marcados);
end $$;

-- Equipe do relógio, agora com cargo, local (centro de custo) e escala vigente
create or replace function public.mcp_rhid_equipe(p_token text, p_busca text default null, p_unidade text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.cliente_id || ':' || p.id, 'nome', p.nome, 'cpf', p.cpf, 'matricula', p.matricula, 'admissao', p.admissao,
      'cliente', c.nome, 'empresa_rh', public.rhid_raiz(p.cliente_id, p.empresa_id),
      'local', coalesce(cc.nome, ''), 'unidade', coalesce(d.nome, ''), 'cargo', coalesce(cg.nome, ''),
      'escala', coalesce(es.nome, ''), 'escala_horario', coalesce(es.horario, ''), 'escala_desde', p.escala_desde,
      'ultima_batida', u.ultima, 'escala_hoje', nullif(regexp_replace(h.horario, E'\\r?\\n', ' / ', 'g'), ''),
      'saldo_banco_min', s.saldo, 'saldo_banco', case when s.saldo is null then null else
        (case when s.saldo < 0 then '-' else '+' end) || (abs(s.saldo) / 60) || 'h' || lpad((abs(s.saldo) % 60)::text, 2, '0') end,
      'no_rh', exists (select 1 from public.esocial_trabalhadores t where t.cpf = p.cpf and t.empresa_id = public.rhid_raiz(p.cliente_id, p.empresa_id))
    ) order by c.nome, cc.nome, d.nome, p.nome), '[]'::jsonb) into v
  from public.rhid_pessoas p
  join public.rhid_clientes c on c.id = p.cliente_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  left join public.rhid_centros_custo cc on cc.cliente_id = p.cliente_id and cc.id = p.centro_custo_id
  left join public.rhid_cargos cg on cg.cliente_id = p.cliente_id and cg.id = p.cargo_id
  left join public.rhid_escalas es on es.cliente_id = p.cliente_id and es.id = p.escala_id
  left join lateral (select max(x.dia) ultima from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and jsonb_array_length(x.batidas) > 0) u on true
  left join lateral (select x.saldo_banco saldo from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.saldo_banco is not null and x.dia <= v_hoje order by x.dia desc limit 1) s on true
  left join lateral (select x.horario from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id and x.dia = v_hoje) h on true
  where p.situacao = 1 and p.presente and (p.cpf <> '' or u.ultima is not null)
    and (p_busca is null or (p.cliente_id, p.id) in (select a.cliente_id, a.id from public.rhid_achar_pessoas(p_busca) a))
    and (p_unidade is null or unaccent(coalesce(d.nome, '') || ' ' || coalesce(cc.nome, '')) ilike '%' || unaccent(p_unidade) || '%');
  perform public.mcp_rhid_auth(p_token, 'rhid_equipe', jsonb_strip_nulls(jsonb_build_object('busca', p_busca, 'unidade', p_unidade)), jsonb_array_length(v));
  return jsonb_build_object('hoje', v_hoje, 'pessoas', v);
end $$;
revoke execute on function public.mcp_rhid_equipe(text, text, text) from public, authenticated;
grant execute on function public.mcp_rhid_equipe(text, text, text) to anon;

-- Contas do relógio ("ADM", "TESTE": sem departamento e sem cargo no RHiD) não são pessoas: não entram no RH
-- (migration rhid_sincronizar_rh_contas_relogio). A versão vigente de rhid_sincronizar_rh é esta:
update public.esocial_trabalhadores t set ativo = false
where t.origem = 'ponto' and t.ativo
  and not exists (select 1 from public.rhid_pessoas p join public.rhid_empresas e on e.cliente_id = p.cliente_id and e.id = p.empresa_id
                  where p.cpf = t.cpf and left(e.cnpj, 8) = t.empresa_id and (p.departamento_id is not null or p.cargo_id is not null));

create or replace function public.rhid_sincronizar_rh()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_novos int; v_marcados int; v_completados int; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  create temp table _ponto on commit drop as
  select distinct on (left(e.cnpj, 8), p.cpf)
    left(e.cnpj, 8) raiz, p.cpf, p.nome, p.matricula, p.admissao, p.situacao,
    (p.departamento_id is not null or p.cargo_id is not null) pessoa_real,
    case when cc.nome ~* 'cicchetti' then 'CICCHETTI' when cc.nome ~* 'filha da lua' then 'FDL' when cc.nome ~* 'sempre vivo' then 'SV'
         when d.nome ~* '\(CC\)' then 'CICCHETTI' when d.nome ~* '\(FDL\)' then 'FDL' when d.nome ~* '\(SV\)' then 'SV'
         when left(e.cnpj, 8) = '36528542' then 'Genesis' else coalesce(d.nome, '') end depto,
    coalesce(cg.nome, '') cargo,
    (select max(x.dia) from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id
       and jsonb_array_length(x.batidas) > 0) ultima
  from public.rhid_pessoas p
  join public.rhid_empresas e on e.cliente_id = p.cliente_id and e.id = p.empresa_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  left join public.rhid_centros_custo cc on cc.cliente_id = p.cliente_id and cc.id = p.centro_custo_id
  left join public.rhid_cargos cg on cg.cliente_id = p.cliente_id and cg.id = p.cargo_id
  where p.presente and length(p.cpf) = 11 and length(e.cnpj) = 14
  order by left(e.cnpj, 8), p.cpf, p.situacao desc nulls last, p.admissao desc nulls last;

  -- Só pessoas de verdade (com departamento ou cargo no RHiD): "ADM" e "TESTE" são contas do relógio
  insert into public.esocial_trabalhadores (empresa_id, cpf, nome, matricula, admissao, unidade, cargo, origem)
  select x.raiz, x.cpf, x.nome, x.matricula, x.admissao, x.depto, x.cargo, 'ponto'
  from _ponto x
  where x.situacao = 1 and x.pessoa_real and exists (select 1 from public.esocial_empresas e where e.id = x.raiz)
  on conflict do nothing;
  get diagnostics v_novos = row_count;

  update public.esocial_trabalhadores t set
    cargo = case when coalesce(t.cargo, '') = '' then x.cargo else t.cargo end,
    unidade = case when coalesce(t.unidade, '') = '' then x.depto else t.unidade end,
    admissao = coalesce(t.admissao, x.admissao)
  from _ponto x
  where x.raiz = t.empresa_id and x.cpf = t.cpf
    and ((coalesce(t.cargo, '') = '' and x.cargo <> '') or (coalesce(t.unidade, '') = '' and x.depto <> '') or (t.admissao is null and x.admissao is not null));
  get diagnostics v_completados = row_count;

  update public.esocial_trabalhadores t set
    ponto_situacao = case
      when x.cpf is null then 'sem_ponto'
      when x.situacao is distinct from 1 then 'inativo'
      when x.ultima >= v_hoje - 3 then 'batendo'
      when x.ultima is null or x.ultima < v_hoje - 7 then 'parou'
      else 'batendo' end,
    ponto_ultima_batida = x.ultima,
    ponto_atualizado_em = now()
  from public.esocial_trabalhadores t2
  left join _ponto x on x.raiz = t2.empresa_id and x.cpf = t2.cpf
  where t.empresa_id = t2.empresa_id and t.cpf = t2.cpf;
  get diagnostics v_marcados = row_count;
  return jsonb_build_object('novos', v_novos, 'completados', v_completados, 'marcados', v_marcados);
end $$;

-- ---------------------------------------------------------------------
-- Justificativas do RHiD (out/2026): a lista vem por POST em customerdb/justification.svc/list
-- (ini, fim, page, maxSize; filtros vazios = todo mundo). Atestados, afastamentos, férias, licenças,
-- abonos, banco e folgas compensadas, com o período e se há arquivo anexado (o arquivo não se copia).
-- Quem está afastado por justificativa que cobre hoje fica 'afastado' no Ponto × RH, e o eSocial
-- não gasta acesso relendo essa pessoa antes de 7 dias.
-- ---------------------------------------------------------------------
create table if not exists public.rhid_justificativas (
  cliente_id bigint not null references public.rhid_clientes(id),
  id bigint not null,
  pessoa_id bigint,
  tipo_id bigint,
  texto text not null default '',
  descricao text not null default '',
  inicio timestamptz,
  fim timestamptz,
  minutos_diurno int,
  minutos_noturno int,
  aprovacao int,
  tem_arquivo boolean not null default false,
  inserido_em timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, id)
);
create index if not exists rhid_justificativas_pessoa on public.rhid_justificativas (cliente_id, pessoa_id, inicio desc);

do $$
declare t text := 'rhid_justificativas';
begin
  execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
  execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
  execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists "ver" on public.%I', t);
  execute format('create policy "ver" on public.%I for select using (public.rhid_pode_ver(auth.uid()))', t);
  execute format('revoke all on public.%I from anon', t);
  execute format('grant select on public.%I to authenticated', t);
end $$;

-- Justificativa que afasta (férias, atestado, licença, auxílio-doença, suspensão), pelo nome do tipo
create or replace function public.rhid_tipo_afasta(p_nome text)
returns boolean language sql immutable as $$
  select coalesce(p_nome, '') ~* 'afast|f[ée]rias|licen[çc]a|aux[íi]lio|atestado|maternidade|paternidade|suspens'
$$;

-- Ponto × RH: 'afastado' quando há justificativa de afastamento aprovada cobrindo hoje
create or replace function public.rhid_sincronizar_rh()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_novos int; v_marcados int; v_completados int; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  create temp table _ponto on commit drop as
  select distinct on (left(e.cnpj, 8), p.cpf)
    left(e.cnpj, 8) raiz, p.cpf, p.nome, p.matricula, p.admissao, p.situacao,
    (p.departamento_id is not null or p.cargo_id is not null) pessoa_real,
    case when cc.nome ~* 'cicchetti' then 'CICCHETTI' when cc.nome ~* 'filha da lua' then 'FDL' when cc.nome ~* 'sempre vivo' then 'SV'
         when d.nome ~* '\(CC\)' then 'CICCHETTI' when d.nome ~* '\(FDL\)' then 'FDL' when d.nome ~* '\(SV\)' then 'SV'
         when left(e.cnpj, 8) = '36528542' then 'Genesis' else coalesce(d.nome, '') end depto,
    coalesce(cg.nome, '') cargo,
    (select max(x.dia) from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id
       and jsonb_array_length(x.batidas) > 0) ultima,
    exists (select 1 from public.rhid_justificativas j
            left join public.rhid_justificativa_tipos jt on jt.cliente_id = j.cliente_id and jt.id = j.tipo_id
            where j.cliente_id = p.cliente_id and j.pessoa_id = p.id and coalesce(j.aprovacao, 2) = 2
              and (j.inicio at time zone 'America/Fortaleza')::date <= v_hoje and (j.fim at time zone 'America/Fortaleza')::date >= v_hoje
              and public.rhid_tipo_afasta(coalesce(jt.nome, j.texto))) afastado
  from public.rhid_pessoas p
  join public.rhid_empresas e on e.cliente_id = p.cliente_id and e.id = p.empresa_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  left join public.rhid_centros_custo cc on cc.cliente_id = p.cliente_id and cc.id = p.centro_custo_id
  left join public.rhid_cargos cg on cg.cliente_id = p.cliente_id and cg.id = p.cargo_id
  where p.presente and length(p.cpf) = 11 and length(e.cnpj) = 14
  order by left(e.cnpj, 8), p.cpf, p.situacao desc nulls last, p.admissao desc nulls last;

  insert into public.esocial_trabalhadores (empresa_id, cpf, nome, matricula, admissao, unidade, cargo, origem)
  select x.raiz, x.cpf, x.nome, x.matricula, x.admissao, x.depto, x.cargo, 'ponto'
  from _ponto x
  where x.situacao = 1 and x.pessoa_real and exists (select 1 from public.esocial_empresas e where e.id = x.raiz)
  on conflict do nothing;
  get diagnostics v_novos = row_count;

  update public.esocial_trabalhadores t set
    cargo = case when coalesce(t.cargo, '') = '' then x.cargo else t.cargo end,
    unidade = case when coalesce(t.unidade, '') = '' then x.depto else t.unidade end,
    admissao = coalesce(t.admissao, x.admissao)
  from _ponto x
  where x.raiz = t.empresa_id and x.cpf = t.cpf
    and ((coalesce(t.cargo, '') = '' and x.cargo <> '') or (coalesce(t.unidade, '') = '' and x.depto <> '') or (t.admissao is null and x.admissao is not null));
  get diagnostics v_completados = row_count;

  update public.esocial_trabalhadores t set
    ponto_situacao = case
      when x.cpf is null then 'sem_ponto'
      when x.situacao is distinct from 1 then 'inativo'
      when x.afastado then 'afastado'
      when x.ultima >= v_hoje - 3 then 'batendo'
      when x.ultima is null or x.ultima < v_hoje - 7 then 'parou'
      else 'batendo' end,
    ponto_ultima_batida = x.ultima,
    ponto_atualizado_em = now()
  from public.esocial_trabalhadores t2
  left join _ponto x on x.raiz = t2.empresa_id and x.cpf = t2.cpf
  where t.empresa_id = t2.empresa_id and t.cpf = t2.cpf;
  get diagnostics v_marcados = row_count;
  return jsonb_build_object('novos', v_novos, 'completados', v_completados, 'marcados', v_marcados);
end $$;

-- esocial_proximo: quem está afastado (pelo RHiD) também espera 7 dias para ser relido
do $$
declare v_def text := pg_get_functiondef('public.esocial_proximo(text)'::regprocedure);
begin
  if position('''afastado''' in v_def) = 0 then
    v_def := replace(v_def,
      $a$case when t.ponto_situacao = 'batendo' then interval '7 days' else interval '2 days' end$a$,
      $b$case when t.ponto_situacao in ('batendo', 'afastado') then interval '7 days' else interval '2 days' end$b$);
    if position('''afastado''' in v_def) = 0 then raise exception 'esocial_proximo mudou: revise a troca'; end if;
    execute v_def;
  end if;
end $$;

-- Conector: justificativas de uma pessoa, de uma unidade ou de todo mundo num período
create or replace function public.mcp_rhid_justificativas(p_token text, p_pessoa text default null, p_unidade text default null, p_de date default null, p_ate date default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; v_de date; v_ate date; v jsonb; v_afastados jsonb;
begin
  v_ate := coalesce(p_ate, v_hoje + 60);
  v_de := coalesce(p_de, v_hoje - 30);
  if v_ate - v_de > 400 then raise exception 'Período longo demais (máximo de 400 dias).'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'pessoa', p.nome, 'id', p.cliente_id || ':' || p.id, 'unidade', coalesce(d.nome, ''), 'local', coalesce(cc.nome, ''),
      'tipo', coalesce(jt.nome, ''), 'texto', j.texto, 'descricao', j.descricao,
      'inicio', (j.inicio at time zone 'America/Fortaleza')::date, 'fim', (j.fim at time zone 'America/Fortaleza')::date,
      'afasta', public.rhid_tipo_afasta(coalesce(jt.nome, j.texto)), 'aprovada', coalesce(j.aprovacao, 2) = 2,
      'com_arquivo', j.tem_arquivo, 'minutos_abonados', coalesce(j.minutos_diurno, 0) + coalesce(j.minutos_noturno, 0),
      'lancada_em', (j.inserido_em at time zone 'America/Fortaleza')::date
    ) order by j.inicio desc, p.nome), '[]'::jsonb) into v
  from public.rhid_justificativas j
  join public.rhid_pessoas p on p.cliente_id = j.cliente_id and p.id = j.pessoa_id
  left join public.rhid_justificativa_tipos jt on jt.cliente_id = j.cliente_id and jt.id = j.tipo_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  left join public.rhid_centros_custo cc on cc.cliente_id = p.cliente_id and cc.id = p.centro_custo_id
  where (j.inicio at time zone 'America/Fortaleza')::date <= v_ate and (j.fim at time zone 'America/Fortaleza')::date >= v_de
    and (p_pessoa is null or (p.cliente_id, p.id) in (select a.cliente_id, a.id from public.rhid_achar_pessoas(p_pessoa) a))
    and (p_unidade is null or unaccent(coalesce(d.nome, '') || ' ' || coalesce(cc.nome, '')) ilike '%' || unaccent(p_unidade) || '%');
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_afastados from jsonb_array_elements(v) x
    where (x->>'afasta')::boolean and (x->>'inicio')::date <= v_hoje and (x->>'fim')::date >= v_hoje;
  perform public.mcp_rhid_auth(p_token, 'rhid_justificativas', jsonb_strip_nulls(jsonb_build_object('pessoa', p_pessoa, 'unidade', p_unidade, 'de', v_de, 'ate', v_ate)), jsonb_array_length(v));
  return jsonb_build_object('de', v_de, 'ate', v_ate, 'hoje', v_hoje, 'afastados_hoje', v_afastados, 'justificativas', v);
end $$;
revoke execute on function public.mcp_rhid_justificativas(text, text, text, date, date) from public, authenticated;
grant execute on function public.mcp_rhid_justificativas(text, text, text, date, date) to anon;

-- ---------------------------------------------------------------------
-- Rotinas do ponto revistas (30/10/2026). Antes: 18 leituras seguidas de manhã (5h–7h50), quase todas sem
-- nada a fazer, relendo as justificativas a cada uma; e de dia só às 12h e 17h, então "quem está
-- trabalhando agora" ficava velho por horas. Agora:
--   rhid-agora (a cada 10 min, das 6h à meia-noite): tipo "agora" — as 10 últimas batidas de cada empresa
--     (util.svc/ultimasmarcacoes, uma chamada) e o dia de hoje de quem bateu; de hora em hora, o dia de
--     quem tem escala hoje (rhid_pessoas.hoje_em).
--   rhid-batidas (5h10 e 5h40) e rhid-batidas-dia (12h, 17h e 22h): tipo "batidas" — a semana que passou e a
--     escala das próximas 5 semanas (FUTUROS = 34 na Edge Function).
--   Justificativas: no máximo uma leitura por hora por empresa (rhid_clientes.justificativas_em).
-- ---------------------------------------------------------------------
alter table public.rhid_execucoes drop constraint if exists rhid_execucoes_tipo_check;
alter table public.rhid_execucoes add constraint rhid_execucoes_tipo_check check (tipo in ('cadastros', 'batidas', 'agora'));
alter table public.rhid_pessoas add column if not exists hoje_em timestamptz;
alter table public.rhid_clientes add column if not exists justificativas_em timestamptz;

create or replace function public.rhid_agenda_agora()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if (select count(*) from vault.secrets where name in ('rhid_email', 'rhid_senha')) < 2 then return; end if;
  perform public.rhid_pedir('agora', 'agenda', null);
end $$;
revoke execute on function public.rhid_agenda_agora() from public, anon, authenticated;

-- Horários em UTC (Fortaleza = UTC−3)
select cron.unschedule('rhid-batidas') where exists (select 1 from cron.job where jobname = 'rhid-batidas');
select cron.schedule('rhid-batidas', '10,40 8 * * *', $job$ select public.rhid_agenda_batidas() $job$);
select cron.unschedule('rhid-batidas-dia') where exists (select 1 from cron.job where jobname = 'rhid-batidas-dia');
select cron.schedule('rhid-batidas-dia', '0 1,15,20 * * *', $job$ select public.rhid_agenda_batidas() $job$);
select cron.unschedule('rhid-agora') where exists (select 1 from cron.job where jobname = 'rhid-agora');
select cron.schedule('rhid-agora', '*/10 0-2,9-23 * * *', $job$ select public.rhid_agenda_agora() $job$);
