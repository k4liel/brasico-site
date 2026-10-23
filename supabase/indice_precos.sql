-- =====================================================================
-- Índice de Preços: base com todos os itens de todas as notas de compra (CMV)
-- das unidades no Cicchetti Management, para acompanhar o preço de cada item
-- por fornecedor e data. Serve de base para outros projetos.
--
-- A agenda precos-coleta (pg_cron, a cada minuto) chama precos_coletar():
--   1. a cada 6 h, relê a lista de notas de cada unidade (todo o histórico, 500 por página);
--   2. busca os itens das notas que ainda não têm itens (ou que mudaram depois da coleta),
--      no máximo 25 por minuto, somando no limite das consultas dos sócios.
-- A chave da API fica só no Vault (cicchetti_api_chave). Cada chamada fica em
-- cicchetti_consultas (endpoint 'coleta_notas' / 'coleta_itens', sem usuário).
-- Quem vê: só quem está em cicchetti_acesso.
-- =====================================================================

create table if not exists public.precos_notas (
  id uuid primary key,                       -- id da nota no Cicchetti Management
  unidade text not null,                     -- midway | pipa_centro | pipa_producao
  numero text, serie text, modelo text, fonte text, status text,
  fornecedor text not null default '',
  data_emissao date, data_entrada date, competencia text,
  valor_produtos numeric, valor_desconto numeric, valor_frete numeric, valor_impostos numeric, valor_total numeric,
  atualizado_origem timestamptz,             -- atualizado_em da nota no Cicchetti
  itens_coletados_em timestamptz,            -- quando os itens foram lidos
  tentativas int not null default 0,
  erro text not null default '',
  visto_em timestamptz not null default now()
);
create index if not exists precos_notas_pendentes on public.precos_notas (itens_coletados_em nulls first);
create index if not exists precos_notas_emissao on public.precos_notas (unidade, data_emissao);

create table if not exists public.precos_itens (
  id uuid primary key,                       -- id do item no Cicchetti Management
  nota_id uuid not null references public.precos_notas(id),
  unidade text not null,
  ordem int,
  descricao text not null default '',
  produto text not null default '',          -- descrição padronizada (maiúsculas, sem espaços extras)
  codigo_fornecedor text, ean text, ncm text, cfop text,
  unidade_compra text,
  quantidade numeric, valor_unitario numeric, valor_total numeric,
  desconto_rateado numeric, frete_rateado numeric,
  preco_efetivo numeric,                     -- (total - desconto + frete) / quantidade
  fator_conversao numeric, quantidade_base numeric, custo_unitario_base numeric, custo_total_base numeric,
  categoria text, area text, entra_no_cmv boolean, status_classificacao text,
  atualizado_origem timestamptz,
  coletado_em timestamptz not null default now()
);
create index if not exists precos_itens_nota on public.precos_itens (nota_id);
create index if not exists precos_itens_produto on public.precos_itens (produto);

create table if not exists public.precos_coleta (
  unidade text primary key,
  lista_lida_em timestamptz,
  notas int not null default 0,
  erro text not null default ''
);
insert into public.precos_coleta (unidade) values ('midway'), ('pipa_centro'), ('pipa_producao') on conflict do nothing;

-- Exclusões bloqueadas, como no resto do Brasico
do $$
declare t text;
begin
  foreach t in array array['precos_notas', 'precos_itens', 'precos_coleta'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

alter table public.precos_notas enable row level security;
alter table public.precos_itens enable row level security;
alter table public.precos_coleta enable row level security;
drop policy if exists "ver notas" on public.precos_notas;
create policy "ver notas" on public.precos_notas for select using (public.cicchetti_pode_ver(auth.uid()));
drop policy if exists "ver itens" on public.precos_itens;
create policy "ver itens" on public.precos_itens for select using (public.cicchetti_pode_ver(auth.uid()));
drop policy if exists "ver coleta" on public.precos_coleta;
create policy "ver coleta" on public.precos_coleta for select using (public.cicchetti_pode_ver(auth.uid()));
revoke all on public.precos_notas, public.precos_itens, public.precos_coleta from anon;
grant select on public.precos_notas, public.precos_itens, public.precos_coleta to authenticated;

create or replace function public.precos_padronizar(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

-- Uma chamada GET à API, registrada em cicchetti_consultas. Devolve o corpo (ou null em erro).
create or replace function public.precos_api(p_caminho text, p_params jsonb, p_endpoint text, p_unidade text)
returns jsonb language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  base constant text := 'https://www.cicchettimanagement.com/api/integracoes/externas/v1';
  v_chave text; v_url text; v_resp extensions.http_response; v_corpo jsonb; v_erro text;
begin
  select decrypted_secret into v_chave from vault.decrypted_secrets where name = 'cicchetti_api_chave';
  if coalesce(v_chave, '') = '' then raise exception 'Chave da API do Cicchetti Management não cadastrada.'; end if;
  select base || p_caminho || coalesce('?' || string_agg(k || '=' || extensions.urlencode(v), '&' order by k), '')
    into v_url from jsonb_each_text(p_params) as p(k, v);
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
    v_resp := extensions.http(('GET', v_url,
      array[extensions.http_header('Authorization', 'Bearer ' || v_chave), extensions.http_header('Accept', 'application/json')],
      null, null)::extensions.http_request);
    v_corpo := v_resp.content::jsonb;
  exception when others then
    insert into public.cicchetti_consultas (endpoint, unidade, erro) values (p_endpoint, p_unidade, 'falha de conexão');
    return null;
  end;
  v_erro := case when v_resp.status between 200 and 299 then '' else coalesce(v_corpo #>> '{error,message}', 'HTTP ' || v_resp.status) end;
  insert into public.cicchetti_consultas (endpoint, unidade, http_status, request_id, erro)
  values (p_endpoint, p_unidade, v_resp.status, v_corpo #>> '{meta,request_id}', v_erro);
  if v_erro <> '' then return null; end if;
  return v_corpo -> 'data';
end $$;
revoke execute on function public.precos_api(text, jsonb, text, text) from public, anon, authenticated;

-- Um passo da coleta. p_max = quantas notas ler os itens neste passo.
create or replace function public.precos_coletar(p_max int default 25)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  c record; n record; v_dados jsonb; v_pag int; v_total int; v_feitas int := 0; v_itens int := 0; i jsonb;
begin
  -- Não trava se outro passo ainda estiver rodando
  if not pg_try_advisory_xact_lock(hashtext('precos_coletar')) then return jsonb_build_object('pulou', true); end if;

  -- 1. Lista de notas de cada unidade (todo o histórico), a cada 6 h
  for c in select * from public.precos_coleta where lista_lida_em is null or lista_lida_em < now() - interval '6 hours' loop
    v_pag := 1; v_total := 0;
    loop
      v_dados := public.precos_api('/cmv/notas', jsonb_build_object('unidade', c.unidade, 'limite', 500, 'pagina', v_pag), 'coleta_notas', c.unidade);
      v_feitas := v_feitas + 1;
      exit when v_dados is null;
      insert into public.precos_notas as p (id, unidade, numero, serie, modelo, fonte, status, fornecedor, data_emissao, data_entrada,
        competencia, valor_produtos, valor_desconto, valor_frete, valor_impostos, valor_total, atualizado_origem, visto_em)
      select (x->>'id')::uuid, c.unidade, x->>'numero', x->>'serie', x->>'modelo_documento', x->>'fonte', x->>'status',
        coalesce(x->>'fornecedor_nome', ''), (x->>'data_emissao')::date, (x->>'data_entrada')::date, x->>'competencia',
        (x->>'valor_produtos')::numeric, (x->>'valor_desconto')::numeric, (x->>'valor_frete')::numeric,
        (x->>'valor_impostos')::numeric, (x->>'valor_total')::numeric, (x->>'atualizado_em')::timestamptz, now()
      from jsonb_array_elements(v_dados->'notas') x
      on conflict (id) do update set status = excluded.status, fornecedor = excluded.fornecedor,
        data_emissao = excluded.data_emissao, data_entrada = excluded.data_entrada, competencia = excluded.competencia,
        valor_produtos = excluded.valor_produtos, valor_desconto = excluded.valor_desconto, valor_frete = excluded.valor_frete,
        valor_impostos = excluded.valor_impostos, valor_total = excluded.valor_total,
        atualizado_origem = excluded.atualizado_origem, visto_em = now();
      v_total := v_total + jsonb_array_length(v_dados->'notas');
      exit when not coalesce((v_dados #>> '{paginacao,tem_proxima}')::boolean, false) or v_pag >= 50;
      v_pag := v_pag + 1;
    end loop;
    update public.precos_coleta set lista_lida_em = case when v_dados is null then lista_lida_em else now() end,
      notas = case when v_dados is null then notas else v_total end,
      erro = case when v_dados is null then 'falha ao ler a lista' else '' end
    where unidade = c.unidade;
  end loop;

  -- 2. Itens das notas sem itens (ou alteradas depois da coleta), respeitando o limite da API
  for n in
    select * from public.precos_notas
    where tentativas < 5 and (itens_coletados_em is null or atualizado_origem > itens_coletados_em)
    order by itens_coletados_em nulls first, data_emissao desc
    limit greatest(0, least(p_max, 60 - (select count(*) from public.cicchetti_consultas where created_at > now() - interval '1 minute')::int))
  loop
    v_dados := public.precos_api('/cmv/notas/' || n.id || '/itens', jsonb_build_object('unidade', n.unidade), 'coleta_itens', n.unidade);
    v_feitas := v_feitas + 1;
    if v_dados is null then
      update public.precos_notas set tentativas = tentativas + 1, erro = 'falha ao ler os itens' where id = n.id;
      continue;
    end if;
    for i in select * from jsonb_array_elements(v_dados->'itens') loop
      insert into public.precos_itens as t (id, nota_id, unidade, ordem, descricao, produto, codigo_fornecedor, ean, ncm, cfop,
        unidade_compra, quantidade, valor_unitario, valor_total, desconto_rateado, frete_rateado, preco_efetivo,
        fator_conversao, quantidade_base, custo_unitario_base, custo_total_base, categoria, area, entra_no_cmv,
        status_classificacao, atualizado_origem, coletado_em)
      values ((i->>'id')::uuid, n.id, n.unidade, (i->>'item_ordem')::int, coalesce(i->>'descricao_original', ''),
        public.precos_padronizar(i->>'descricao_original'), i->>'codigo_fornecedor', nullif(i->>'ean', 'SEM GTIN'), i->>'ncm', i->>'cfop',
        upper(i->>'unidade_compra'), (i->>'quantidade_compra')::numeric, (i->>'valor_unitario')::numeric, (i->>'valor_total')::numeric,
        coalesce((i->>'valor_desconto_rateado')::numeric, 0), coalesce((i->>'valor_frete_rateado')::numeric, 0),
        case when coalesce((i->>'quantidade_compra')::numeric, 0) > 0 then
          round(((i->>'valor_total')::numeric - coalesce((i->>'valor_desconto_rateado')::numeric, 0)
                 + coalesce((i->>'valor_frete_rateado')::numeric, 0)) / (i->>'quantidade_compra')::numeric, 4) end,
        (i->>'fator_conversao')::numeric, (i->>'quantidade_base')::numeric, (i->>'custo_unitario_base')::numeric,
        (i->>'custo_total_base')::numeric, i->>'categoria_sugerida', i->>'area_sugerida', (i->>'entra_no_cmv')::boolean,
        i->>'status_classificacao', (i->>'atualizado_em')::timestamptz, now())
      on conflict (id) do update set descricao = excluded.descricao, produto = excluded.produto,
        unidade_compra = excluded.unidade_compra, quantidade = excluded.quantidade, valor_unitario = excluded.valor_unitario,
        valor_total = excluded.valor_total, desconto_rateado = excluded.desconto_rateado, frete_rateado = excluded.frete_rateado,
        preco_efetivo = excluded.preco_efetivo, fator_conversao = excluded.fator_conversao, quantidade_base = excluded.quantidade_base,
        custo_unitario_base = excluded.custo_unitario_base, custo_total_base = excluded.custo_total_base,
        categoria = excluded.categoria, area = excluded.area, entra_no_cmv = excluded.entra_no_cmv,
        status_classificacao = excluded.status_classificacao, atualizado_origem = excluded.atualizado_origem, coletado_em = now();
      v_itens := v_itens + 1;
    end loop;
    update public.precos_notas set itens_coletados_em = now(), tentativas = 0, erro = '' where id = n.id;
  end loop;

  return jsonb_build_object('chamadas', v_feitas, 'itens', v_itens);
end $$;
revoke execute on function public.precos_coletar(int) from public, anon, authenticated;
alter function public.precos_coletar(int) set statement_timeout = '55s';

-- Histórico de preços: uma linha por item comprado, já com a data e o fornecedor
create or replace view public.precos_historico with (security_invoker = true) as
select i.produto, i.descricao, i.unidade_compra, i.categoria, i.area, i.ean, i.codigo_fornecedor,
  n.unidade, n.fornecedor, n.data_emissao, n.numero as nota_numero, n.id as nota_id,
  i.quantidade, i.valor_unitario, i.preco_efetivo, i.valor_total, i.custo_unitario_base, i.entra_no_cmv
from public.precos_itens i join public.precos_notas n on n.id = i.nota_id;
grant select on public.precos_historico to authenticated;

-- Agenda: um passo por minuto
select cron.unschedule('precos-coleta') where exists (select 1 from cron.job where jobname = 'precos-coleta');
select cron.schedule('precos-coleta', '* * * * *', $job$ select public.precos_coletar(25) $job$);

-- ---------------------------------------------------------------------
-- Conector: consulta da base de preços (ferramenta precos_consultar)
-- p_busca: palavras da descrição (todas precisam aparecer). Sem busca, traz os itens
-- mais comprados. Devolve um resumo por produto e as compras (mais recentes primeiro).
-- ---------------------------------------------------------------------
create or replace function public.mcp_precos(p_token text, p_busca text default null, p_unidade text default null,
  p_fornecedor text default null, p_de date default null, p_ate date default null, p_limite int default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; v_lim int := least(greatest(coalesce(p_limite, 60), 1), 300); v_res jsonb;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.cicchetti_pode_ver(a.o_user) then
    raise exception 'Sem acesso à base de preços (só quem tem acesso ao Cicchetti Management)' using errcode = '42501';
  end if;

  with base as (
    select h.* from public.precos_historico h
    where (p_unidade is null or h.unidade = p_unidade)
      and (p_fornecedor is null or h.fornecedor ilike '%' || p_fornecedor || '%')
      and (p_de is null or h.data_emissao >= p_de) and (p_ate is null or h.data_emissao <= p_ate)
      and (coalesce(trim(p_busca), '') = '' or not exists (
        select 1 from regexp_split_to_table(public.precos_padronizar(p_busca), ' ') w where h.produto not like '%' || w || '%'))
      and h.preco_efetivo is not null
  ), resumo as (
    select produto, unidade_compra, count(*) compras, sum(quantidade) quantidade, sum(valor_total) gasto,
      round(min(preco_efetivo), 2) menor, round(max(preco_efetivo), 2) maior,
      round(sum(preco_efetivo * quantidade) / nullif(sum(quantidade), 0), 2) medio,
      (array_agg(round(preco_efetivo, 2) order by data_emissao, nota_id))[1] primeiro_preco, min(data_emissao) primeira_compra,
      (array_agg(round(preco_efetivo, 2) order by data_emissao desc, nota_id))[1] ultimo_preco, max(data_emissao) ultima_compra,
      array_agg(distinct fornecedor) fornecedores, array_agg(distinct unidade) unidades
    from base group by produto, unidade_compra
  )
  select jsonb_build_object(
    'coleta', (select jsonb_build_object('notas', count(*), 'notas_com_itens', count(itens_coletados_em),
       'de', min(data_emissao), 'ate', max(data_emissao)) from public.precos_notas),
    'produtos', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('variacao_pct',
        case when r.primeiro_preco > 0 then round((r.ultimo_preco / r.primeiro_preco - 1) * 100, 1) end) order by r.gasto desc)
      from (select * from resumo order by gasto desc limit v_lim) r), '[]'),
    'compras', coalesce((select jsonb_agg(jsonb_build_object('data', data_emissao, 'unidade', unidade, 'fornecedor', fornecedor,
        'descricao', descricao, 'unidade_compra', unidade_compra, 'quantidade', quantidade, 'preco_unitario', valor_unitario,
        'preco_efetivo', round(preco_efetivo, 2), 'total', valor_total, 'nota', nota_numero) order by data_emissao desc)
      from (select * from base order by data_emissao desc limit v_lim) b), '[]'),
    'observacao', 'preco_efetivo = (total - desconto + frete) / quantidade, na unidade de compra da nota. Compare só itens na mesma unidade de compra.'
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.mcp_precos(text, text, text, text, date, date, int) from public, authenticated;
grant execute on function public.mcp_precos(text, text, text, text, date, date, int) to anon;
alter function public.mcp_precos(text, text, text, text, date, date, int) set statement_timeout = '15s';
