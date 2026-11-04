-- =====================================================================
-- NFS-e (nota de serviço) pelo Ambiente de Dados Nacional (ADN) do Sistema Nacional NFS-e
--  - API de distribuição dos contribuintes: GET https://adn.nfse.gov.br/contribuintes/DFe/{NSU}
--    com o certificado A1 (mTLS). Devolve, em ordem de NSU, todas as NFS-e e eventos em que o
--    CNPJ é emitente (emitida = a favor), tomador (tomada = contra) ou intermediário.
--  - Certificado: o do próprio CNPJ ou o da matriz da mesma raiz, com ?cnpjConsulta=<CNPJ>
--    (Manual dos Contribuintes – APIs do ADN, v1.0 de 12/02/2026).
--  - Desde 01/2026 os municípios compartilham as NFS-e no ADN (LC 214/2025); nota antiga
--    de prefeitura com sistema próprio pode não estar lá.
--  - Mesmo desenho das notas: nfse_pedir → pg_net → /api/nfse → nfse_worker_gravar (cada lote) →
--    nfse_worker_concluir. Segredo: o mesmo notas_segredo das NF-e.
-- Quem vê: notas_acesso (os sócios). Página: /notas, aba NFS-e.
-- =====================================================================

create table if not exists public.nfse_empresas (
  cnpj text primary key,
  raiz text not null,
  nome text not null,
  ativa boolean not null default true,           -- entra na rotina diária
  ult_nsu bigint not null default 0,             -- último NSU já lido
  bloqueado_ate timestamptz,                     -- espera depois de chegar ao fim da fila ou de um 429
  ultima_consulta timestamptz,
  ultimo_status text,
  atualizado_em timestamptz not null default now()
);
insert into public.nfse_empresas (cnpj, raiz, nome)
select f.cnpj, f.raiz, coalesce(f.apelido, f.razao, f.cnpj)
from public.fiscal_empresas f
where exists (select 1 from public.certificados c where left(c.cnpj, 8) = f.raiz)
on conflict (cnpj) do nothing;

-- Uma linha por NFS-e e CNPJ do grupo (a mesma nota pode ser emitida por uma empresa e tomada por outra)
create table if not exists public.nfse_notas (
  empresa_cnpj text not null references public.nfse_empresas(cnpj),
  chave text not null,                           -- chave de acesso de 50 dígitos
  papel text not null check (papel in ('emitida', 'tomada', 'intermediada')),
  numero text,
  emissao timestamptz,
  competencia date,
  emitente_cnpj text,
  emitente_nome text,
  emitente_municipio text,
  tomador_doc text,
  tomador_nome text,
  local_incidencia text,                         -- município onde o ISS é devido
  codigo_servico text,                           -- código de tributação nacional (cTribNac)
  descricao text,
  valor_servico numeric,
  base_calculo numeric,
  aliquota numeric,
  iss numeric,
  iss_retido boolean,                            -- true: quem paga o ISS é o tomador ou o intermediário
  valor_liquido numeric,
  situacao text not null default 'normal' check (situacao in ('normal', 'cancelada', 'substituida')),
  nsu bigint,
  xml text,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_cnpj, chave)
);
create index if not exists nfse_notas_emissao on public.nfse_notas (empresa_cnpj, papel, emissao desc);
create index if not exists nfse_notas_chave on public.nfse_notas (chave);

create table if not exists public.nfse_eventos (
  id bigint generated always as identity primary key,
  empresa_cnpj text not null,
  chave text not null,
  tipo text not null,                            -- 101101 cancelamento, 105102 substituição, ...
  descricao text,
  quando timestamptz,
  nsu bigint,
  xml text,
  created_at timestamptz not null default now()
);
create unique index if not exists nfse_eventos_nsu on public.nfse_eventos (empresa_cnpj, nsu);
create index if not exists nfse_eventos_chave on public.nfse_eventos (chave);

create table if not exists public.nfse_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_cnpj text not null references public.nfse_empresas(cnpj),
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'sem_dados', 'falha')),
  origem text not null default 'manual',         -- manual, agenda, encadeada
  resultado jsonb not null default '{}',
  erro text,
  pedido_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  inicio timestamptz,
  fim timestamptz
);
create index if not exists nfse_execucoes_empresa on public.nfse_execucoes (empresa_cnpj, created_at desc);

do $$ declare t text; begin
  foreach t in array array['nfse_empresas', 'nfse_notas', 'nfse_eventos', 'nfse_execucoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
  end loop;
end $$;
do $$ begin alter publication supabase_realtime add table public.nfse_execucoes; exception when duplicate_object then null; end $$;

-- Certificado usado: o do próprio CNPJ, se válido por mais um dia; senão o da matriz da mesma raiz
create or replace function public.nfse_certificado(p_cnpj text)
returns public.certificados language sql stable security definer set search_path = public as $$
  select c.* from public.certificados c
  where left(c.cnpj, 8) = left(p_cnpj, 8) and c.validade > now() + interval '1 day' and c.cofre is not null
  order by (c.cnpj = p_cnpj) desc, c.matriz desc, c.validade desc
  limit 1
$$;
revoke execute on function public.nfse_certificado(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pedir uma leitura: confere certificado, espera e um pedido por vez
-- ---------------------------------------------------------------------
create or replace function public.nfse_pedir(p_cnpj text, p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare e public.nfse_empresas; c public.certificados; v_id uuid;
begin
  select * into e from public.nfse_empresas where cnpj = p_cnpj;
  if e.cnpj is null then raise exception 'Empresa % não está nas NFS-e.', p_cnpj; end if;
  c := public.nfse_certificado(p_cnpj);
  if c.cnpj is null then raise exception 'Não há certificado válido da raiz de %. Envie o .pfx em Certificados digitais.', e.nome; end if;
  if e.bloqueado_ate > now() and coalesce(p_origem, 'manual') <> 'encadeada' then
    raise exception 'O Portal Nacional pede para esperar até % antes de consultar % de novo.',
      to_char(e.bloqueado_ate at time zone 'America/Fortaleza', 'HH24:MI'), e.nome;
  end if;
  if exists (select 1 from public.nfse_execucoes where empresa_cnpj = p_cnpj and status in ('na_fila', 'rodando')
             and created_at > now() - interval '10 minutes') then
    raise exception 'Já há uma leitura em andamento para %. Aguarde ela terminar.', e.nome;
  end if;

  insert into public.nfse_execucoes (empresa_cnpj, origem, pedido_por)
  values (p_cnpj, coalesce(p_origem, 'manual'), p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/nfse',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'notas_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.nfse_pedir(text, text, uuid) from public, anon, authenticated;

-- Botão "Buscar agora" da página (sócios)
create or replace function public.nfse_buscar(p_cnpj text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às notas' using errcode = '42501'; end if;
  return public.nfse_pedir(p_cnpj, 'manual', auth.uid());
end $$;
revoke execute on function public.nfse_buscar(text) from public, anon;
grant execute on function public.nfse_buscar(text) to authenticated;

create or replace function public.nfse_ajustar(p_cnpj text, p_ativa boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às notas' using errcode = '42501'; end if;
  update public.nfse_empresas set ativa = p_ativa, atualizado_em = now() where cnpj = p_cnpj;
end $$;
revoke execute on function public.nfse_ajustar(text, boolean) from public, anon;
grant execute on function public.nfse_ajustar(text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Rota do site (/api/nfse)
-- ---------------------------------------------------------------------
create or replace function public.nfse_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.nfse_execucoes; e public.nfse_empresas; c public.certificados;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.nfse_execucoes set status = 'rodando', inicio = now()
  where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.nfse_empresas where cnpj = x.empresa_cnpj;
  c := public.nfse_certificado(e.cnpj);
  return jsonb_build_object(
    'execucao', jsonb_build_object('id', x.id, 'origem', x.origem),
    'empresa', jsonb_build_object('cnpj', e.cnpj, 'nome', e.nome, 'ult_nsu', e.ult_nsu),
    'cert_cnpj', c.cnpj,
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = c.cofre));
end $$;
revoke execute on function public.nfse_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.nfse_worker_pegar(text, uuid) to anon;

-- Grava um lote. p_notas: [{chave, papel, numero, emissao, competencia, emitente_cnpj, emitente_nome,
--   emitente_municipio, tomador_doc, tomador_nome, local_incidencia, codigo_servico, descricao, valor_servico,
--   base_calculo, aliquota, iss, iss_retido, valor_liquido, nsu, xml}]
-- p_eventos: [{chave, tipo, descricao, quando, nsu, xml}]. Cancelamento e substituição marcam a nota.
create or replace function public.nfse_worker_gravar(p_segredo text, p_execucao uuid, p_notas jsonb, p_eventos jsonb, p_ult_nsu bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.nfse_execucoes; n jsonb; v jsonb; v_notas int := 0; v_eventos int := 0;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.nfse_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then raise exception 'Execução % não está rodando', p_execucao; end if;

  for n in select * from jsonb_array_elements(coalesce(p_notas, '[]')) loop
    insert into public.nfse_notas as t (empresa_cnpj, chave, papel, numero, emissao, competencia, emitente_cnpj,
      emitente_nome, emitente_municipio, tomador_doc, tomador_nome, local_incidencia, codigo_servico, descricao,
      valor_servico, base_calculo, aliquota, iss, iss_retido, valor_liquido, nsu, xml)
    values (x.empresa_cnpj, n->>'chave', n->>'papel', n->>'numero', (n->>'emissao')::timestamptz,
      (n->>'competencia')::date, n->>'emitente_cnpj', n->>'emitente_nome', n->>'emitente_municipio',
      n->>'tomador_doc', n->>'tomador_nome', n->>'local_incidencia', n->>'codigo_servico', n->>'descricao',
      (n->>'valor_servico')::numeric, (n->>'base_calculo')::numeric, (n->>'aliquota')::numeric, (n->>'iss')::numeric,
      (n->>'iss_retido')::boolean, (n->>'valor_liquido')::numeric, (n->>'nsu')::bigint, n->>'xml')
    on conflict (empresa_cnpj, chave) do update set
      papel = excluded.papel, numero = excluded.numero, emissao = excluded.emissao, competencia = excluded.competencia,
      emitente_cnpj = excluded.emitente_cnpj, emitente_nome = excluded.emitente_nome,
      emitente_municipio = excluded.emitente_municipio, tomador_doc = excluded.tomador_doc,
      tomador_nome = excluded.tomador_nome, local_incidencia = excluded.local_incidencia,
      codigo_servico = excluded.codigo_servico, descricao = excluded.descricao, valor_servico = excluded.valor_servico,
      base_calculo = excluded.base_calculo, aliquota = excluded.aliquota, iss = excluded.iss,
      iss_retido = excluded.iss_retido, valor_liquido = excluded.valor_liquido, nsu = excluded.nsu, xml = excluded.xml,
      atualizado_em = now();
    v_notas := v_notas + 1;
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p_eventos, '[]')) loop
    insert into public.nfse_eventos (empresa_cnpj, chave, tipo, descricao, quando, nsu, xml)
    values (x.empresa_cnpj, v->>'chave', v->>'tipo', v->>'descricao', (v->>'quando')::timestamptz,
      (v->>'nsu')::bigint, v->>'xml')
    on conflict do nothing;
    v_eventos := v_eventos + 1;
  end loop;

  -- Situação vem dos eventos (também dos que chegaram antes da própria nota)
  update public.nfse_notas t set situacao = case when exists (
      select 1 from public.nfse_eventos v where v.chave = t.chave and v.tipo = '105102') then 'substituida' else 'cancelada' end,
    atualizado_em = now()
  where t.empresa_cnpj = x.empresa_cnpj and t.situacao = 'normal'
    and exists (select 1 from public.nfse_eventos v where v.chave = t.chave
                and v.tipo in ('101101', '105102', '105104', '305101'));

  update public.nfse_empresas set ult_nsu = greatest(ult_nsu, coalesce(p_ult_nsu, 0)), atualizado_em = now()
  where cnpj = x.empresa_cnpj;
  return jsonb_build_object('notas', v_notas, 'eventos', v_eventos);
end $$;
revoke execute on function public.nfse_worker_gravar(text, uuid, jsonb, jsonb, bigint) from public, authenticated;
grant execute on function public.nfse_worker_gravar(text, uuid, jsonb, jsonb, bigint) to anon;

-- Fim da leitura. Se a rota parou no meio (tempo), encadeia a continuação (no máximo 40 por empresa por dia).
create or replace function public.nfse_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_erro text,
  p_resultado jsonb, p_bloquear_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare x public.nfse_execucoes;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.nfse_execucoes set status = p_status, erro = nullif(p_erro, ''), fim = now(),
    resultado = coalesce(p_resultado, '{}')
  where id = p_execucao and status = 'rodando' returning * into x;
  if x.id is null then return; end if;
  update public.nfse_empresas set ultima_consulta = now(), bloqueado_ate = p_bloquear_ate,
    ultimo_status = left(coalesce(nullif(p_erro, ''), p_status), 200), atualizado_em = now()
  where cnpj = x.empresa_cnpj;
  if p_status = 'ok' and coalesce((p_resultado->>'continua')::boolean, false)
     and (select count(*) from public.nfse_execucoes where empresa_cnpj = x.empresa_cnpj and origem = 'encadeada'
          and created_at > now() - interval '1 day') < 40 then
    perform public.nfse_pedir(x.empresa_cnpj, 'encadeada', null);
  end if;
end $$;
revoke execute on function public.nfse_worker_concluir(text, uuid, text, text, jsonb, timestamptz) from public, authenticated;
grant execute on function public.nfse_worker_concluir(text, uuid, text, text, jsonb, timestamptz) to anon;

-- Pedido que travou: vira falha depois de 15 minutos
create or replace function public.nfse_destravar()
returns void language sql security definer set search_path = public as $$
  update public.nfse_execucoes set status = 'falha', erro = 'conexão: o site não respondeu a tempo', fim = now()
  where status in ('na_fila', 'rodando') and created_at < now() - interval '15 minutes'
$$;
revoke execute on function public.nfse_destravar() from public, anon, authenticated;

-- Rotina diária: uma leitura por empresa ativa (a continuação se encadeia sozinha)
create or replace function public.nfse_rodada()
returns int language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  perform public.nfse_destravar();
  for e in select cnpj from public.nfse_empresas where ativa and (bloqueado_ate is null or bloqueado_ate < now()) loop
    begin
      perform public.nfse_pedir(e.cnpj, 'agenda', null);
      n := n + 1;
    exception when others then null;  -- sem certificado ou já em andamento: tenta na próxima
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.nfse_rodada() from public, anon, authenticated;

-- 6h30 e 12h30 de Fortaleza (09h30 e 15h30 UTC); destravar a cada 15 min
select cron.unschedule('nfse-diaria') where exists (select 1 from cron.job where jobname = 'nfse-diaria');
select cron.schedule('nfse-diaria', '30 9,15 * * *', $job$ select public.nfse_rodada() $job$);
select cron.unschedule('nfse-destravar') where exists (select 1 from cron.job where jobname = 'nfse-destravar');
select cron.schedule('nfse-destravar', '*/15 * * * *', $job$ select public.nfse_destravar() $job$);

-- Totais por mês, empresa e papel (aba NFS-e da página Notas); canceladas e substituídas ficam fora dos valores
create or replace view public.nfse_meses with (security_invoker = true) as
select to_char(emissao at time zone 'America/Fortaleza', 'YYYY-MM') mes, empresa_cnpj, papel,
  count(*) filter (where situacao = 'normal')::int notas,
  count(*) filter (where situacao <> 'normal')::int canceladas,
  coalesce(sum(valor_servico) filter (where situacao = 'normal'), 0) valor,
  coalesce(sum(iss) filter (where situacao = 'normal'), 0) iss,
  coalesce(sum(iss) filter (where situacao = 'normal' and iss_retido), 0) iss_retido
from public.nfse_notas
where emissao is not null
group by 1, 2, 3;
grant select on public.nfse_meses to authenticated;
