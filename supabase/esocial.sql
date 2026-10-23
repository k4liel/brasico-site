-- =====================================================================
-- eSocial: leitura dos eventos que o contador já transmite, direto do governo
-- (webservices oficiais de consulta de identificadores e download).
--
-- Como funciona:
--  - Cada empresa (raiz do CNPJ) tem um certificado e-CNPJ A1. O sócio envia o
--    .pfx e a senha pela tela do site (Menu → eSocial); o site converte e guarda
--    o certificado no Vault (esocial_cert_<raiz>). A senha não é guardada.
--  - Cada pedido ao governo vira uma linha em esocial_execucoes. O banco chama a
--    rota /api/esocial do site (Vercel, Node), que assina o XML, conversa com o
--    eSocial e devolve o resultado por esocial_worker_concluir.
--    Não roda nas Edge Functions: o eSocial pede o certificado por renegociação
--    TLS, que o Deno não suporta.
--  - Regras do governo (MOD v1.16, seções 7.7 e 7.8): nada de consulta/download
--    do dia 1 ao 7; um pedido por vez por empresa; no máximo 10 acessos por dia
--    por empresa; data final até 1 hora antes de agora; janela de até 31 dias.
--    A agenda usa só esocial_empresas.limite_diario (padrão 6), para sobrar
--    acesso para o contador.
--  - Os dados de cada trabalhador só vêm pelo CPF (consulta por trabalhador),
--    então a lista esocial_trabalhadores precisa ter os CPFs.
--  - Transmissão (envio de eventos) fica para o futuro: esocial_lotes já existe,
--    mas o envio só é aceito na Produção Restrita (testes) e nada é transmitido
--    em produção enquanto esocial_empresas.transmissao estiver desligada.
-- Quem vê: só quem está em esocial_acesso. São dados pessoais (LGPD).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.esocial_acesso (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
-- Começa com os mesmos sócios das vendas TOTVS
insert into public.esocial_acesso (user_id) select user_id from public.totvs_acesso on conflict do nothing;

-- Uma linha por empresa (raiz do CNPJ, 8 posições; letras para o CNPJ alfanumérico)
create table if not exists public.esocial_empresas (
  id text primary key check (id ~ '^[A-Z0-9]{8}$'),
  nome text not null,
  cnpj text check (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  leitura_automatica boolean not null default false,
  limite_diario int not null default 6 check (limite_diario between 0 and 10),
  historico_desde date not null default (date_trunc('month', now() at time zone 'America/Fortaleza') - interval '1 month')::date,
  transmissao boolean not null default false,
  cert_titular text,
  cert_cnpj text,
  cert_emissor text,
  cert_validade timestamptz,
  cert_atualizado_em timestamptz,
  cert_atualizado_por uuid references auth.users(id),
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

-- CPFs consultados por empresa. consultado_ate = até onde (data de recepção no eSocial) já foi lido.
create table if not exists public.esocial_trabalhadores (
  empresa_id text not null references public.esocial_empresas(id),
  cpf text not null check (cpf ~ '^[0-9]{11}$'),
  nome text not null default '',
  matricula text not null default '',
  origem text not null default 'manual' check (origem in ('manual', 'evento')),
  ativo boolean not null default true,
  consultado_ate timestamptz,
  created_at timestamptz not null default now(),
  primary key (empresa_id, cpf)
);

-- Cada pedido ao eSocial (consulta, download, teste e, no futuro, envio de lote)
create table if not exists public.esocial_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id text not null references public.esocial_empresas(id),
  ambiente smallint not null check (ambiente in (1, 2)),
  tipo text not null check (tipo in ('teste_conexao', 'identificadores_tabela', 'identificadores_empregador',
    'identificadores_trabalhador', 'download_id', 'download_recibo', 'envio_lote', 'consulta_lote')),
  parametros jsonb not null default '{}',
  origem text not null check (origem in ('agenda', 'site', 'claude')),
  pedido_por uuid references auth.users(id),
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'sem_dados', 'falha')),
  cd_resposta int,
  desc_resposta text not null default '',
  resultado jsonb not null default '{}',
  erro text not null default '',
  inicio timestamptz,
  fim timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists esocial_execucoes_idx on public.esocial_execucoes (empresa_id, ambiente, created_at desc);

-- Eventos conhecidos (pelo identificador) e baixados (com o XML do evento e do recibo)
create table if not exists public.esocial_eventos (
  ambiente smallint not null check (ambiente in (1, 2)),
  id_evento text not null,
  empresa_id text not null references public.esocial_empresas(id),
  nr_recibo text,
  tipo text,
  cpf_trab text,
  per_apur text,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'baixado', 'indisponivel')),
  resumo jsonb not null default '{}',
  xml_evento text,
  xml_recibo text,
  descoberto_em timestamptz not null default now(),
  baixado_em timestamptz,
  execucao_id uuid,
  primary key (ambiente, id_evento)
);
create index if not exists esocial_eventos_empresa_idx on public.esocial_eventos (empresa_id, ambiente, tipo, per_apur);
create index if not exists esocial_eventos_cpf_idx on public.esocial_eventos (empresa_id, cpf_trab);
create index if not exists esocial_eventos_pendentes_idx on public.esocial_eventos (empresa_id, ambiente) where situacao = 'pendente';

-- Transmissão (futuro): cada lote de até 50 eventos assinados de um mesmo grupo
create table if not exists public.esocial_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id text not null references public.esocial_empresas(id),
  ambiente smallint not null check (ambiente in (1, 2)),
  grupo smallint not null check (grupo in (1, 2, 3)),
  status text not null default 'preparado' check (status in ('preparado', 'enviado', 'processado', 'erro')),
  eventos jsonb not null default '[]',
  protocolo text,
  cd_resposta int,
  desc_resposta text not null default '',
  retorno jsonb not null default '{}',
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  enviado_em timestamptz,
  processado_em timestamptz
);

-- Exclusões bloqueadas, como no resto do Brasico
do $$
declare t text;
begin
  foreach t in array array['esocial_acesso', 'esocial_empresas', 'esocial_trabalhadores', 'esocial_execucoes', 'esocial_eventos', 'esocial_lotes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

create or replace function public.esocial_pode_ver(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.esocial_acesso where user_id = p_user)
$$;
revoke execute on function public.esocial_pode_ver(uuid) from public, anon;
grant execute on function public.esocial_pode_ver(uuid) to authenticated;

alter table public.esocial_acesso enable row level security;
alter table public.esocial_empresas enable row level security;
alter table public.esocial_trabalhadores enable row level security;
alter table public.esocial_execucoes enable row level security;
alter table public.esocial_eventos enable row level security;
alter table public.esocial_lotes enable row level security;

drop policy if exists "ver acesso" on public.esocial_acesso;
create policy "ver acesso" on public.esocial_acesso for select using (user_id = auth.uid());
drop policy if exists "ver empresas" on public.esocial_empresas;
create policy "ver empresas" on public.esocial_empresas for select using (public.esocial_pode_ver(auth.uid()));
drop policy if exists "ver trabalhadores" on public.esocial_trabalhadores;
create policy "ver trabalhadores" on public.esocial_trabalhadores for select using (public.esocial_pode_ver(auth.uid()));
drop policy if exists "ver execucoes" on public.esocial_execucoes;
create policy "ver execucoes" on public.esocial_execucoes for select using (public.esocial_pode_ver(auth.uid()));
drop policy if exists "ver eventos" on public.esocial_eventos;
create policy "ver eventos" on public.esocial_eventos for select using (public.esocial_pode_ver(auth.uid()));
drop policy if exists "ver lotes" on public.esocial_lotes;
create policy "ver lotes" on public.esocial_lotes for select using (public.esocial_pode_ver(auth.uid()));

revoke all on public.esocial_acesso, public.esocial_empresas, public.esocial_trabalhadores, public.esocial_execucoes,
  public.esocial_eventos, public.esocial_lotes from anon;
grant select on public.esocial_acesso, public.esocial_empresas, public.esocial_trabalhadores, public.esocial_execucoes,
  public.esocial_eventos, public.esocial_lotes to authenticated;

do $$ begin alter publication supabase_realtime add table public.esocial_execucoes; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Segredo que protege a rota /api/esocial (gerado ao acaso aqui)
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'esocial_segredo')
where not exists (select 1 from vault.secrets where name = 'esocial_segredo');

create or replace function public.esocial_conferir_segredo(p_segredo text)
returns void language plpgsql stable security definer set search_path = public, vault as $$
begin
  if coalesce(p_segredo, '') = '' or not exists (
    select 1 from vault.decrypted_secrets where name = 'esocial_segredo' and decrypted_secret = p_segredo) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.esocial_conferir_segredo(text) from public, anon, authenticated;

-- Hora de Brasília (as datas dos pedidos ao eSocial são locais)
create or replace function public.esocial_agora()
returns timestamp language sql stable set search_path = public as $$ select (now() at time zone 'America/Sao_Paulo') $$;

-- ---------------------------------------------------------------------
-- Certificado: o site manda o PEM (certificado + chave) já convertido do .pfx
-- ---------------------------------------------------------------------
create or replace function public.esocial_guardar_certificado(p_raiz text, p_nome text, p_cnpj text, p_titular text,
  p_emissor text, p_validade timestamptz, p_pem text)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare v_nome text := 'esocial_cert_' || p_raiz; v_id uuid;
begin
  if not public.esocial_pode_ver(auth.uid()) then raise exception 'Sem acesso ao eSocial' using errcode = '42501'; end if;
  if p_raiz !~ '^[A-Z0-9]{8}$' or p_cnpj !~ '^[A-Z0-9]{12}[0-9]{2}$' or left(p_cnpj, 8) <> p_raiz then
    raise exception 'O certificado não traz um CNPJ válido.';
  end if;
  if p_validade <= now() then raise exception 'Este certificado já venceu.'; end if;
  if coalesce(p_pem, '') not like '%BEGIN CERTIFICATE%' or p_pem not like '%PRIVATE KEY%' then
    raise exception 'Certificado incompleto (falta o certificado ou a chave).';
  end if;

  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then perform vault.create_secret(p_pem, v_nome);
  else perform vault.update_secret(v_id, p_pem); end if;

  insert into public.esocial_empresas (id, nome, cnpj, cert_titular, cert_cnpj, cert_emissor, cert_validade, cert_atualizado_em, cert_atualizado_por)
  values (p_raiz, p_nome, p_cnpj, p_titular, p_cnpj, p_emissor, p_validade, now(), auth.uid())
  on conflict (id) do update set cnpj = coalesce(public.esocial_empresas.cnpj, excluded.cnpj),
    cert_titular = excluded.cert_titular, cert_cnpj = excluded.cert_cnpj, cert_emissor = excluded.cert_emissor,
    cert_validade = excluded.cert_validade, cert_atualizado_em = now(), cert_atualizado_por = auth.uid();
  return jsonb_build_object('empresa', p_raiz, 'nome', p_nome, 'validade', p_validade);
end $$;
revoke execute on function public.esocial_guardar_certificado(text, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.esocial_guardar_certificado(text, text, text, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- Pedir uma chamada ao eSocial: confere as regras do governo, registra e chama o site
-- ---------------------------------------------------------------------
create or replace function public.esocial_pedir(p_empresa text, p_ambiente int, p_tipo text, p_parametros jsonb,
  p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  e public.esocial_empresas;
  v_id uuid;
  v_download boolean := p_tipo like 'identificadores_%' or p_tipo like 'download_%';
  v_hoje date := public.esocial_agora()::date;
  v_usados int;
  v_limite int;
begin
  select * into e from public.esocial_empresas where id = p_empresa;
  if e.id is null then raise exception 'Empresa "%" não encontrada no eSocial.', p_empresa; end if;
  if p_ambiente not in (1, 2) then raise exception 'Ambiente inválido (1 = produção, 2 = produção restrita).'; end if;
  if e.cert_validade is null then raise exception 'A empresa % ainda não tem certificado.', e.nome; end if;
  if e.cert_validade <= now() then raise exception 'O certificado da empresa % venceu. Envie o novo pela tela do eSocial.', e.nome; end if;
  if p_tipo = 'envio_lote' and (p_ambiente = 1 and not e.transmissao) then
    raise exception 'A transmissão em produção está desligada. Só é possível enviar na Produção Restrita (testes).';
  end if;

  if v_download then
    if extract(day from v_hoje) <= 7 then
      raise exception 'O eSocial não aceita consultas nem downloads do dia 1 ao dia 7 de cada mês.';
    end if;
    if exists (select 1 from public.esocial_execucoes where empresa_id = e.id and ambiente = p_ambiente
               and status in ('na_fila', 'rodando') and created_at > now() - interval '10 minutes'
               and (tipo like 'identificadores_%' or tipo like 'download_%')) then
      raise exception 'Já há um pedido em andamento para esta empresa. O eSocial aceita um por vez; tente em instantes.';
    end if;
    select count(*) into v_usados from public.esocial_execucoes
    where empresa_id = e.id and ambiente = p_ambiente and (created_at at time zone 'America/Sao_Paulo')::date = v_hoje
      and (tipo like 'identificadores_%' or tipo like 'download_%')
      and not (status = 'falha' and cd_resposta is null and erro like 'conexão:%');
    v_limite := case when p_origem = 'agenda' then e.limite_diario else 10 end;
    if v_usados >= v_limite then
      raise exception 'Limite de % acessos de hoje ao download do eSocial já foi usado para esta empresa (o governo permite 10 por dia).', v_limite;
    end if;
  end if;

  insert into public.esocial_execucoes (empresa_id, ambiente, tipo, parametros, origem, pedido_por)
  values (e.id, p_ambiente, p_tipo, coalesce(p_parametros, '{}'), p_origem, p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/esocial',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'esocial_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.esocial_pedir(text, int, text, jsonb, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Rota do site (/api/esocial): pega o pedido com o certificado e devolve o resultado
-- ---------------------------------------------------------------------
create or replace function public.esocial_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.esocial_execucoes; e public.esocial_empresas;
begin
  perform public.esocial_conferir_segredo(p_segredo);
  update public.esocial_execucoes set status = 'rodando', inicio = now()
  where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.esocial_empresas where id = x.empresa_id;
  return jsonb_build_object(
    'execucao', to_jsonb(x),
    'empresa', jsonb_build_object('id', e.id, 'nome', e.nome, 'cnpj', e.cnpj),
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = 'esocial_cert_' || e.id));
end $$;
revoke execute on function public.esocial_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.esocial_worker_pegar(text, uuid) to anon;

-- p_eventos: [{id_evento, nr_recibo, tipo, cpf_trab, per_apur, situacao, resumo, xml_evento, xml_recibo}]
-- (esocial_worker_concluir: definição atual no fim do arquivo, em "Leitura inteligente")
grant execute on function public.esocial_worker_concluir(text, uuid, text, int, text, jsonb, text, jsonb) to anon;

-- ---------------------------------------------------------------------
-- Leitura automática (produção): um passo por vez, até o limite diário da empresa
-- Ordem: baixar eventos pendentes → fechamento e totais do mês (S-1299, S-5011, S-5013)
--        → estabelecimentos (S-1005) → eventos de cada trabalhador, em janelas de até 31 dias
-- ---------------------------------------------------------------------
-- (esocial_proximo: definição atual no fim do arquivo, em "Leitura inteligente")

create or replace function public.esocial_agenda()
returns void language plpgsql security definer set search_path = public as $$
declare e record;
begin
  for e in select id from public.esocial_empresas where leitura_automatica order by ordem, id loop
    perform public.esocial_proximo(e.id);
  end loop;
end $$;
revoke execute on function public.esocial_agenda() from public, anon, authenticated;

-- Um passo por empresa a cada 15 minutos, das 8h às 20h de Brasília (11h às 23h UTC).
-- Espaçado de propósito: o download do eSocial anda instável (erro 500 intermitente, Serpro, ago/2026)
-- e chamadas seguidas falham mais. O limite diário de cada empresa continua valendo.
select cron.unschedule('esocial-diario') where exists (select 1 from cron.job where jobname = 'esocial-diario');
select cron.schedule('esocial-diario', '*/15 11-22 * * *', $job$ select public.esocial_agenda() $job$);

-- Pedido que travou (site não respondeu): vira falha depois de 15 minutos
create or replace function public.esocial_destravar()
returns void language sql security definer set search_path = public as $$
  update public.esocial_execucoes set status = 'falha', erro = 'conexão: o site não respondeu a tempo', fim = now()
  where status in ('na_fila', 'rodando') and created_at < now() - interval '15 minutes'
$$;
revoke execute on function public.esocial_destravar() from public, anon, authenticated;
select cron.unschedule('esocial-destravar') where exists (select 1 from cron.job where jobname = 'esocial-destravar');
select cron.schedule('esocial-destravar', '*/15 * * * *', $job$ select public.esocial_destravar() $job$);

-- ---------------------------------------------------------------------
-- Botões do site
-- ---------------------------------------------------------------------
create or replace function public.esocial_checar()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.esocial_pode_ver(auth.uid()) then raise exception 'Sem acesso ao eSocial' using errcode = '42501'; end if;
end $$;
revoke execute on function public.esocial_checar() from public, anon, authenticated;

-- Consulta ou download avulso (teste_conexao, identificadores_*, download_*, consulta_lote)
create or replace function public.esocial_consultar(p_empresa text, p_ambiente int, p_tipo text, p_parametros jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.esocial_checar();
  if p_tipo not in ('teste_conexao', 'identificadores_tabela', 'identificadores_empregador', 'identificadores_trabalhador',
                    'download_id', 'download_recibo', 'consulta_lote') then
    raise exception 'Tipo de pedido não permitido pelo site: %', p_tipo;
  end if;
  return public.esocial_pedir(p_empresa, p_ambiente, p_tipo, p_parametros, 'site', auth.uid());
end $$;
revoke execute on function public.esocial_consultar(text, int, text, jsonb) from public, anon;
grant execute on function public.esocial_consultar(text, int, text, jsonb) to authenticated;

-- Baixa os eventos pendentes (até 50)
create or replace function public.esocial_baixar_pendentes(p_empresa text, p_ambiente int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ids jsonb;
begin
  perform public.esocial_checar();
  select jsonb_agg(id_evento) into v_ids from (
    select id_evento from public.esocial_eventos where empresa_id = p_empresa and ambiente = p_ambiente and situacao = 'pendente'
    order by descoberto_em limit 50) p;
  if v_ids is null then raise exception 'Não há eventos pendentes para baixar.'; end if;
  return public.esocial_pedir(p_empresa, p_ambiente, 'download_id', jsonb_build_object('ids', v_ids), 'site', auth.uid());
end $$;
revoke execute on function public.esocial_baixar_pendentes(text, int) from public, anon;
grant execute on function public.esocial_baixar_pendentes(text, int) to authenticated;

-- Acrescenta CPFs (só números; os inválidos são ignorados e devolvidos)
create or replace function public.esocial_adicionar_cpfs(p_empresa text, p_cpfs text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; v_ok int := 0; v_ruins text[] := '{}';
begin
  perform public.esocial_checar();
  if not exists (select 1 from public.esocial_empresas where id = p_empresa) then raise exception 'Empresa não encontrada.'; end if;
  foreach c in array coalesce(p_cpfs, '{}') loop
    c := regexp_replace(c, '\D', '', 'g');
    if c = '' then continue; end if;
    if not public.esocial_cpf_valido(c) then v_ruins := v_ruins || c; continue; end if;
    insert into public.esocial_trabalhadores (empresa_id, cpf, origem) values (p_empresa, c, 'manual')
    on conflict (empresa_id, cpf) do update set ativo = true;
    v_ok := v_ok + 1;
  end loop;
  return jsonb_build_object('adicionados', v_ok, 'invalidos', to_jsonb(v_ruins));
end $$;
revoke execute on function public.esocial_adicionar_cpfs(text, text[]) from public, anon;
grant execute on function public.esocial_adicionar_cpfs(text, text[]) to authenticated;

create or replace function public.esocial_cpf_valido(p text)
returns boolean language plpgsql immutable set search_path = public as $$
declare s int; d1 int; d2 int; i int;
begin
  if p !~ '^[0-9]{11}$' or p ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(p, i, 1)::int * (11 - i); end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0; for i in 1..10 loop s := s + substr(p, i, 1)::int * (12 - i); end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return d1 = substr(p, 10, 1)::int and d2 = substr(p, 11, 1)::int;
end $$;

-- Liga/desliga a leitura automática e ajusta limite e início do histórico
create or replace function public.esocial_configurar(p_empresa text, p_leitura boolean, p_limite int, p_historico_desde date)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.esocial_checar();
  if p_limite is not null and (p_limite < 0 or p_limite > 10) then raise exception 'O limite diário vai de 0 a 10.'; end if;
  if p_historico_desde is not null and p_historico_desde < date '2018-01-01' then raise exception 'Data de início muito antiga.'; end if;
  update public.esocial_empresas set
    leitura_automatica = coalesce(p_leitura, leitura_automatica),
    limite_diario = coalesce(p_limite, limite_diario),
    historico_desde = coalesce(p_historico_desde, historico_desde)
  where id = p_empresa;
  if not found then raise exception 'Empresa não encontrada.'; end if;
end $$;
revoke execute on function public.esocial_configurar(text, boolean, int, date) from public, anon;
grant execute on function public.esocial_configurar(text, boolean, int, date) to authenticated;

-- ---------------------------------------------------------------------
-- Conector (ferramentas esocial_* do Claude): só leitura
-- ---------------------------------------------------------------------
create or replace function public.mcp_esocial_auth(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.esocial_pode_ver(a.o_user) then raise exception 'Sem acesso ao eSocial' using errcode = '42501'; end if;
  return a.o_user;
end $$;
revoke execute on function public.mcp_esocial_auth(text) from public, anon, authenticated;

create or replace function public.mcp_esocial_situacao(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.mcp_esocial_auth(p_token);
  return jsonb_build_object('agora_brasilia', public.esocial_agora(), 'empresas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'cnpj', e.cnpj, 'certificado_valido_ate', e.cert_validade,
      'leitura_automatica', e.leitura_automatica, 'limite_diario', e.limite_diario, 'historico_desde', e.historico_desde,
      'trabalhadores', (select count(*) from public.esocial_trabalhadores t where t.empresa_id = e.id and t.ativo),
      'eventos', (select coalesce(jsonb_object_agg(coalesce(x.tipo, '?') || ' ' || x.situacao, x.n), '{}'::jsonb)
                  from (select tipo, situacao, count(*) n from public.esocial_eventos v where v.empresa_id = e.id and v.ambiente = 1
                        group by 1, 2) x),
      'ultimas_execucoes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'ambiente', x.ambiente, 'status', x.status,
          'codigo', x.cd_resposta, 'resposta', nullif(x.desc_resposta, ''), 'erro', nullif(x.erro, ''),
          'quando', to_char(x.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')) order by x.created_at desc), '[]'::jsonb)
        from (select * from public.esocial_execucoes z where z.empresa_id = e.id order by z.created_at desc limit 8) x)
    ) order by e.ordem, e.nome)
    from public.esocial_empresas e), '[]'::jsonb));
end $$;

create or replace function public.mcp_esocial_eventos(p_token text, p_empresa text default null, p_tipo text default null,
  p_cpf text default null, p_per_apur text default null, p_limite int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.mcp_esocial_auth(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('empresa', v.empresa_id, 'tipo', v.tipo, 'id', v.id_evento,
      'recibo', v.nr_recibo, 'cpf', v.cpf_trab, 'competencia', v.per_apur, 'situacao', v.situacao, 'resumo', v.resumo,
      'baixado_em', v.baixado_em) order by v.per_apur desc nulls last, v.tipo)
    from (select * from public.esocial_eventos x
          where x.ambiente = 1 and (p_empresa is null or x.empresa_id = upper(p_empresa))
            and (p_tipo is null or x.tipo = upper(p_tipo)) and (p_cpf is null or x.cpf_trab = regexp_replace(p_cpf, '\D', '', 'g'))
            and (p_per_apur is null or x.per_apur = p_per_apur)
          order by x.descoberto_em desc limit least(greatest(coalesce(p_limite, 100), 1), 500)) v), '[]'::jsonb);
end $$;

revoke execute on function public.mcp_esocial_situacao(text) from public, authenticated;
revoke execute on function public.mcp_esocial_eventos(text, text, text, text, text, int) from public, authenticated;
grant execute on function public.mcp_esocial_situacao(text) to anon;
grant execute on function public.mcp_esocial_eventos(text, text, text, text, text, int) to anon;

-- ---------------------------------------------------------------------
-- Cadastro da equipe (planilha do contador) e registro das consultas do conector
-- ---------------------------------------------------------------------
-- Dados do cadastro para a equipe aparecer antes dos eventos chegarem
alter table public.esocial_trabalhadores add column if not exists cargo text not null default '';
alter table public.esocial_trabalhadores add column if not exists admissao date;
alter table public.esocial_trabalhadores add column if not exists unidade text not null default '';

-- Registro de cada leitura de dados de funcionários feita pelo conector (Claude). LGPD art. 37.
create table if not exists public.esocial_consultas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  origem text not null check (origem in ('claude', 'site')),
  ferramenta text not null,
  parametros jsonb not null default '{}',
  quantidade int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists esocial_consultas_idx on public.esocial_consultas (created_at desc);
drop trigger if exists esocial_consultas_sem_exclusao on public.esocial_consultas;
create trigger esocial_consultas_sem_exclusao before delete on public.esocial_consultas for each row execute function public.bloquear_exclusao();
drop trigger if exists esocial_consultas_sem_truncate on public.esocial_consultas;
create trigger esocial_consultas_sem_truncate before truncate on public.esocial_consultas for each statement execute function public.bloquear_exclusao();
alter table public.esocial_consultas enable row level security;
drop policy if exists "ver consultas" on public.esocial_consultas;
create policy "ver consultas" on public.esocial_consultas for select using (public.esocial_pode_ver(auth.uid()));
revoke all on public.esocial_consultas from anon;
grant select on public.esocial_consultas to authenticated;

-- mcp_esocial_situacao e mcp_esocial_eventos passam a gravar uma linha em esocial_consultas a cada chamada
-- (mesmo corpo de antes; só o insert foi acrescentado). Ver a migração esocial_trabalhadores_cadastro_e_registro_consultas.
create or replace function public.mcp_esocial_situacao(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  v_user := public.mcp_esocial_auth(p_token);
  insert into public.esocial_consultas (user_id, origem, ferramenta) values (v_user, 'claude', 'esocial_situacao');
  return jsonb_build_object('agora_brasilia', public.esocial_agora(), 'empresas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'cnpj', e.cnpj, 'certificado_valido_ate', e.cert_validade,
      'leitura_automatica', e.leitura_automatica, 'limite_diario', e.limite_diario, 'historico_desde', e.historico_desde,
      'trabalhadores', (select count(*) from public.esocial_trabalhadores t where t.empresa_id = e.id and t.ativo),
      'eventos', (select coalesce(jsonb_object_agg(coalesce(x.tipo, '?') || ' ' || x.situacao, x.n), '{}'::jsonb)
                  from (select tipo, situacao, count(*) n from public.esocial_eventos v where v.empresa_id = e.id and v.ambiente = 1
                        group by 1, 2) x),
      'ultimas_execucoes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'ambiente', x.ambiente, 'status', x.status,
          'codigo', x.cd_resposta, 'resposta', nullif(x.desc_resposta, ''), 'erro', nullif(x.erro, ''),
          'quando', to_char(x.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')) order by x.created_at desc), '[]'::jsonb)
        from (select * from public.esocial_execucoes z where z.empresa_id = e.id order by z.created_at desc limit 8) x)
    ) order by e.ordem, e.nome)
    from public.esocial_empresas e), '[]'::jsonb));
end $$;

create or replace function public.mcp_esocial_eventos(p_token text, p_empresa text default null, p_tipo text default null,
  p_cpf text default null, p_per_apur text default null, p_limite int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_res jsonb;
begin
  v_user := public.mcp_esocial_auth(p_token);
  v_res := coalesce((select jsonb_agg(jsonb_build_object('empresa', v.empresa_id, 'tipo', v.tipo, 'id', v.id_evento,
      'recibo', v.nr_recibo, 'cpf', v.cpf_trab, 'competencia', v.per_apur, 'situacao', v.situacao, 'resumo', v.resumo,
      'baixado_em', v.baixado_em) order by v.per_apur desc nulls last, v.tipo)
    from (select * from public.esocial_eventos x
          where x.ambiente = 1 and (p_empresa is null or x.empresa_id = upper(p_empresa))
            and (p_tipo is null or x.tipo = upper(p_tipo)) and (p_cpf is null or x.cpf_trab = regexp_replace(p_cpf, '\D', '', 'g'))
            and (p_per_apur is null or x.per_apur = p_per_apur)
          order by x.descoberto_em desc limit least(greatest(coalesce(p_limite, 100), 1), 500)) v), '[]'::jsonb);
  insert into public.esocial_consultas (user_id, origem, ferramenta, parametros, quantidade)
  values (v_user, 'claude', 'esocial_eventos',
    jsonb_strip_nulls(jsonb_build_object('empresa', p_empresa, 'tipo', p_tipo, 'cpf', case when p_cpf is null then null else 'informado' end, 'competencia', p_per_apur)),
    jsonb_array_length(v_res));
  return v_res;
end $$;

-- Equipe (nome, cargo, admissão e unidade) para o conector, com o mesmo registro
create or replace function public.mcp_esocial_equipe(p_token text, p_empresa text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_res jsonb;
begin
  v_user := public.mcp_esocial_auth(p_token);
  v_res := coalesce((select jsonb_agg(jsonb_build_object('empresa', t.empresa_id, 'nome', t.nome, 'cargo', t.cargo, 'unidade', t.unidade,
      'admissao', t.admissao, 'matricula', t.matricula, 'cpf', t.cpf, 'origem', t.origem, 'lido_ate', t.consultado_ate) order by t.unidade, t.nome)
    from public.esocial_trabalhadores t where t.ativo and (p_empresa is null or t.empresa_id = upper(p_empresa))), '[]'::jsonb);
  insert into public.esocial_consultas (user_id, origem, ferramenta, parametros, quantidade)
  values (v_user, 'claude', 'esocial_equipe', jsonb_strip_nulls(jsonb_build_object('empresa', p_empresa)), jsonb_array_length(v_res));
  return v_res;
end $$;
revoke execute on function public.mcp_esocial_equipe(text, text) from public, authenticated;
grant execute on function public.mcp_esocial_equipe(text, text) to anon;

-- Cadastro vindo da planilha (site): nome, cargo, admissão e unidade junto com o CPF
create or replace function public.esocial_cadastrar_equipe(p_empresa text, p_pessoas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p jsonb; c text; v_ok int := 0; v_ruins text[] := '{}';
begin
  perform public.esocial_checar();
  if not exists (select 1 from public.esocial_empresas where id = p_empresa) then raise exception 'Empresa não encontrada.'; end if;
  for p in select * from jsonb_array_elements(coalesce(p_pessoas, '[]')) loop
    c := regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g');
    if c = '' then continue; end if;
    if not public.esocial_cpf_valido(c) then v_ruins := v_ruins || coalesce(p->>'nome', c); continue; end if;
    insert into public.esocial_trabalhadores as w (empresa_id, cpf, nome, matricula, cargo, admissao, unidade, origem)
    values (p_empresa, c, upper(coalesce(p->>'nome', '')), coalesce(p->>'matricula', ''), upper(coalesce(p->>'cargo', '')),
      nullif(p->>'admissao', '')::date, coalesce(p->>'unidade', ''), 'manual')
    on conflict (empresa_id, cpf) do update set ativo = true,
      nome = case when excluded.nome <> '' then excluded.nome else w.nome end,
      matricula = case when excluded.matricula <> '' then excluded.matricula else w.matricula end,
      cargo = case when excluded.cargo <> '' then excluded.cargo else w.cargo end,
      admissao = coalesce(excluded.admissao, w.admissao),
      unidade = case when excluded.unidade <> '' then excluded.unidade else w.unidade end;
    v_ok := v_ok + 1;
  end loop;
  return jsonb_build_object('cadastrados', v_ok, 'invalidos', to_jsonb(v_ruins));
end $$;
revoke execute on function public.esocial_cadastrar_equipe(text, jsonb) from public, anon;
grant execute on function public.esocial_cadastrar_equipe(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Leitura inteligente (23/10/2026): 10 acessos/dia por empresa. Reserva o último para UM download cheio
-- (até 50 ids); os outros vão para consultas por trabalhador: mês mais recente de todo mundo primeiro,
-- depois quem está desatualizado, depois o histórico para trás, um mês por vez.
-- Os totalizadores do governo (S-5011/5012/5013, ids de 35 posições "ID11…/ID12…/ID13…") aparecem na
-- consulta do S-1299, mas não baixam por este serviço (401 se forem pedidos): ficam como "indisponivel".
-- Não se consulta mais S-5011/S-5013 nem o S-1299 de meses antigos (só os 2 últimos).
-- ---------------------------------------------------------------------
alter table public.esocial_trabalhadores add column if not exists consultado_desde timestamptz;

-- Falhas 401 de download eram os ids de totalizador (já tratados): não contam para a pausa de 20 h
create or replace function public.esocial_download_falhou_hoje(p_empresa text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.esocial_execucoes where empresa_id = p_empresa and ambiente = 1
    and tipo = 'download_id' and status = 'falha' and coalesce(cd_resposta, 0) <> 401 and created_at > now() - interval '20 hours')
$$;
revoke execute on function public.esocial_download_falhou_hoje(text) from public, anon, authenticated;

create or replace function public.esocial_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_cd int,
  p_desc text, p_resultado jsonb, p_erro text, p_eventos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x public.esocial_execucoes; ev jsonb; v_ini timestamptz; v_fim timestamptz;
begin
  perform public.esocial_conferir_segredo(p_segredo);
  update public.esocial_execucoes set status = p_status, cd_resposta = p_cd, desc_resposta = left(coalesce(p_desc, ''), 1000),
    resultado = coalesce(p_resultado, '{}'), erro = left(coalesce(p_erro, ''), 1000), fim = now()
  where id = p_execucao and status = 'rodando' returning * into x;
  if x.id is null then return; end if;

  for ev in select * from jsonb_array_elements(coalesce(p_eventos, '[]')) loop
    insert into public.esocial_eventos as t (ambiente, id_evento, empresa_id, nr_recibo, tipo, cpf_trab, per_apur, situacao,
      resumo, xml_evento, xml_recibo, baixado_em, execucao_id)
    values (x.ambiente, ev->>'id_evento', x.empresa_id, ev->>'nr_recibo', ev->>'tipo', ev->>'cpf_trab', ev->>'per_apur',
      coalesce(ev->>'situacao', 'pendente'), coalesce(ev->'resumo', '{}'), ev->>'xml_evento', ev->>'xml_recibo',
      case when ev->>'situacao' = 'baixado' then now() end, x.id)
    on conflict (ambiente, id_evento) do update set
      nr_recibo = coalesce(excluded.nr_recibo, t.nr_recibo),
      tipo = coalesce(excluded.tipo, t.tipo),
      cpf_trab = coalesce(excluded.cpf_trab, t.cpf_trab),
      per_apur = coalesce(excluded.per_apur, t.per_apur),
      situacao = case when t.situacao = 'baixado' and excluded.situacao = 'pendente' then t.situacao else excluded.situacao end,
      resumo = case when excluded.situacao = 'baixado' then excluded.resumo else t.resumo end,
      xml_evento = coalesce(excluded.xml_evento, t.xml_evento),
      xml_recibo = coalesce(excluded.xml_recibo, t.xml_recibo),
      baixado_em = coalesce(excluded.baixado_em, t.baixado_em),
      execucao_id = excluded.execucao_id;

    if ev->>'cpf_trab' ~ '^[0-9]{11}$' then
      insert into public.esocial_trabalhadores as w (empresa_id, cpf, nome, matricula, origem)
      values (x.empresa_id, ev->>'cpf_trab', coalesce(ev->'resumo'->>'nome', ''), coalesce(ev->'resumo'->>'matricula', ''), 'evento')
      on conflict (empresa_id, cpf) do update set
        nome = case when w.nome = '' then excluded.nome else w.nome end,
        matricula = case when w.matricula = '' then excluded.matricula else w.matricula end;
    end if;
  end loop;

  -- Janela lida de um trabalhador: amplia o trecho coberto (para frente e para trás). Com mais de 50 eventos
  -- na janela (cursor), só o trecho até o cursor conta como lido.
  if x.tipo = 'identificadores_trabalhador' and p_status in ('ok', 'sem_dados') then
    v_ini := (x.parametros->>'dtIni')::timestamp at time zone 'America/Sao_Paulo';
    v_fim := coalesce((p_resultado->>'cursor')::timestamptz, (x.parametros->>'dtFim')::timestamp at time zone 'America/Sao_Paulo');
    update public.esocial_trabalhadores set
      consultado_ate = greatest(coalesce(consultado_ate, v_fim), v_fim),
      consultado_desde = least(coalesce(consultado_desde, v_ini), v_ini)
    where empresa_id = x.empresa_id and cpf = x.parametros->>'cpf';
  end if;
end $$;

create or replace function public.esocial_proximo(p_empresa text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.esocial_empresas;
  v_agora timestamp := public.esocial_agora();
  v_usados int;
  v_pend int;
  v_ids jsonb;
  v_mes date;
  w record;
  v_ini timestamp;
  v_fim timestamp;
  v_desde timestamp;
begin
  select * into e from public.esocial_empresas where id = p_empresa;
  if e.id is null or not e.leitura_automatica or e.cert_validade is null or e.cert_validade <= now() then return null; end if;
  if extract(day from v_agora) <= 7 then return null; end if;
  select count(*) into v_usados from public.esocial_execucoes where empresa_id = e.id and ambiente = 1
    and (created_at at time zone 'America/Sao_Paulo')::date = v_agora::date
    and (tipo like 'identificadores_%' or tipo like 'download_%');
  if v_usados >= e.limite_diario then return null; end if;
  v_desde := e.historico_desde::timestamp;

  begin
    -- 1. Download: só ids de 36 posições (os de 35 são totalizadores, que não baixam). Um por dia, no último
    --    acesso, para ir cheio; antes disso só se já houver 50 esperando.
    select count(*) into v_pend from public.esocial_eventos where empresa_id = e.id and ambiente = 1 and situacao = 'pendente' and length(id_evento) = 36;
    if v_pend > 0 and (v_pend >= 50 or v_usados = e.limite_diario - 1) and not public.esocial_download_falhou_hoje(e.id) then
      select jsonb_agg(id_evento) into v_ids from (
        select id_evento from public.esocial_eventos where empresa_id = e.id and ambiente = 1 and situacao = 'pendente' and length(id_evento) = 36
        order by descoberto_em limit 50) p;
      return public.esocial_pedir(e.id, 1, 'download_id', jsonb_build_object('ids', v_ids), 'agenda', null);
    end if;

    -- 2. Fechamento da folha (S-1299) só dos 2 últimos meses, depois do dia 8; relê depois do dia 20
    for v_mes in select generate_series(greatest(date_trunc('month', v_desde), date_trunc('month', v_agora) - interval '2 months'),
                                        date_trunc('month', v_agora) - interval '1 month', interval '1 month')::date loop
      select max(created_at at time zone 'America/Sao_Paulo') into v_ini from public.esocial_execucoes
      where empresa_id = e.id and ambiente = 1 and tipo = 'identificadores_empregador' and status in ('ok', 'sem_dados')
        and parametros->>'tpEvt' = 'S-1299' and parametros->>'perApur' = to_char(v_mes, 'YYYY-MM');
      v_fim := v_mes + interval '1 month' + interval '19 days';
      if v_ini > v_fim then continue; end if;
      if v_ini is not null and v_agora <= v_fim then continue; end if;
      if v_agora < v_mes + interval '1 month' + interval '7 days' then continue; end if;
      if exists (select 1 from public.esocial_execucoes where empresa_id = e.id and ambiente = 1
          and tipo = 'identificadores_empregador' and status = 'falha' and created_at > now() - interval '3 days'
          and parametros->>'tpEvt' = 'S-1299' and parametros->>'perApur' = to_char(v_mes, 'YYYY-MM')) then continue; end if;
      return public.esocial_pedir(e.id, 1, 'identificadores_empregador',
        jsonb_build_object('tpEvt', 'S-1299', 'perApur', to_char(v_mes, 'YYYY-MM')), 'agenda', null);
    end loop;

    -- 3. Trabalhadores. Para por 3 dias se as 2 últimas consultas voltaram 407 (certificado sem perfil).
    if (select count(*) from (select cd_resposta from public.esocial_execucoes where empresa_id = e.id and ambiente = 1
          and tipo = 'identificadores_trabalhador' and created_at > now() - interval '3 days' order by created_at desc limit 2) u
        where u.cd_resposta = 407) >= 2 then return null; end if;

    -- 3a. Quem nunca foi lido: o mês mais recente (31 dias até 65 min atrás)
    select * into w from public.esocial_trabalhadores t
    where t.empresa_id = e.id and t.ativo and t.consultado_ate is null
      and not exists (select 1 from public.esocial_execucoes f where f.empresa_id = e.id and f.ambiente = 1
        and f.tipo = 'identificadores_trabalhador' and f.status = 'falha' and f.parametros->>'cpf' = t.cpf and f.created_at > now() - interval '20 hours')
    order by t.admissao desc nulls last, t.nome limit 1;
    if w.cpf is not null then
      v_fim := v_agora - interval '65 minutes';
      v_ini := greatest(v_fim - interval '31 days' + interval '1 minute', v_desde);
      return public.esocial_pedir(e.id, 1, 'identificadores_trabalhador', jsonb_build_object('cpf', w.cpf,
        'dtIni', to_char(v_ini, 'YYYY-MM-DD"T"HH24:MI:SS'), 'dtFim', to_char(v_fim, 'YYYY-MM-DD"T"HH24:MI:SS')), 'agenda', null);
    end if;

    -- 3b. Quem está desatualizado há mais de 2 dias: continua para frente
    select * into w from public.esocial_trabalhadores t
    where t.empresa_id = e.id and t.ativo and t.consultado_ate < now() - interval '2 days'
      and not exists (select 1 from public.esocial_execucoes f where f.empresa_id = e.id and f.ambiente = 1
        and f.tipo = 'identificadores_trabalhador' and f.status = 'falha' and f.parametros->>'cpf' = t.cpf and f.created_at > now() - interval '20 hours')
    order by t.consultado_ate limit 1;
    if w.cpf is not null then
      v_ini := w.consultado_ate at time zone 'America/Sao_Paulo';
      v_fim := least(v_ini + interval '31 days' - interval '1 minute', v_agora - interval '65 minutes');
      return public.esocial_pedir(e.id, 1, 'identificadores_trabalhador', jsonb_build_object('cpf', w.cpf,
        'dtIni', to_char(v_ini, 'YYYY-MM-DD"T"HH24:MI:SS'), 'dtFim', to_char(v_fim, 'YYYY-MM-DD"T"HH24:MI:SS')), 'agenda', null);
    end if;

    -- 3c. Histórico para trás, um mês por vez, de quem está mais perto do presente (todos avançam juntos)
    select * into w from public.esocial_trabalhadores t
    where t.empresa_id = e.id and t.ativo and t.consultado_desde is not null
      and t.consultado_desde > greatest(v_desde, coalesce(t.admissao, v_desde::date)::timestamp) at time zone 'America/Sao_Paulo'
      and not exists (select 1 from public.esocial_execucoes f where f.empresa_id = e.id and f.ambiente = 1
        and f.tipo = 'identificadores_trabalhador' and f.status = 'falha' and f.parametros->>'cpf' = t.cpf and f.created_at > now() - interval '20 hours')
    order by t.consultado_desde desc limit 1;
    if w.cpf is not null then
      v_fim := (w.consultado_desde at time zone 'America/Sao_Paulo') - interval '1 second';
      v_ini := greatest(v_fim - interval '31 days' + interval '1 minute', v_desde, coalesce(w.admissao, v_desde::date)::timestamp - interval '10 days');
      return public.esocial_pedir(e.id, 1, 'identificadores_trabalhador', jsonb_build_object('cpf', w.cpf,
        'dtIni', to_char(v_ini, 'YYYY-MM-DD"T"HH24:MI:SS'), 'dtFim', to_char(v_fim, 'YYYY-MM-DD"T"HH24:MI:SS')), 'agenda', null);
    end if;

    -- 4. Estabelecimentos (uma vez por mês)
    if e.cnpj is not null and not exists (select 1 from public.esocial_execucoes where empresa_id = e.id and ambiente = 1
        and tipo = 'identificadores_tabela' and status in ('ok', 'sem_dados') and parametros->>'tpEvt' = 'S-1005'
        and created_at > now() - interval '30 days')
      and not exists (select 1 from public.esocial_execucoes where empresa_id = e.id and ambiente = 1
        and tipo = 'identificadores_tabela' and status = 'falha' and parametros->>'tpEvt' = 'S-1005'
        and parametros ? 'chEvt' and created_at > now() - interval '3 days') then
      return public.esocial_pedir(e.id, 1, 'identificadores_tabela',
        jsonb_build_object('tpEvt', 'S-1005', 'chEvt', 'tpInsc=1;nrInsc=' || e.cnpj), 'agenda', null);
    end if;

    -- 5. Sobrou acesso e há algo para baixar: baixa agora
    if v_pend > 0 and not public.esocial_download_falhou_hoje(e.id) then
      select jsonb_agg(id_evento) into v_ids from (
        select id_evento from public.esocial_eventos where empresa_id = e.id and ambiente = 1 and situacao = 'pendente' and length(id_evento) = 36
        order by descoberto_em limit 50) p;
      return public.esocial_pedir(e.id, 1, 'download_id', jsonb_build_object('ids', v_ids), 'agenda', null);
    end if;
  exception when others then
    return null;
  end;
  return null;
end $$;
revoke execute on function public.esocial_proximo(text) from public, anon, authenticated;
