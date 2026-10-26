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
