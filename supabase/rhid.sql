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
