-- =====================================================================
-- Página de produtos (aba NFC-e › Produtos), refeita em 23/11/2026 a pedido do dono ("muito confusa, uma bagunça; listas
-- que não minimizam; detalhe cada produto com todas as informações; o filtro tem de mostrar o Ponta Negra").
-- totvs_produtos_lista(insumos)  → todos os produtos do cadastro do Chef Web (lido do navegador; totvs_produtos_cadastro),
--                                  com a regra fiscal do NCM na loja, as vendas de 120 dias (NFC-e) e os problemas.
-- totvs_produto_detalhe(loja, código) → a ficha: cadastro inteiro, regra do NCM (nesta e nas outras casas), o mesmo produto
--                                  nas outras casas, como sai na nota (classificações das NFC-e) e as vendas por mês.
-- =====================================================================

-- Vendas de 120 dias por produto (das NFC-e), pronta para a lista; atualizada a cada 30 min (pg_cron totvs-produtos-vendas)
create materialized view if not exists public.totvs_produtos_vendas as
  select n.unidade_id, i->>'codigo' codigo, count(*) itens, round(sum((i->>'quantidade')::numeric), 2) qtd,
    round(sum((i->>'valor_total')::numeric), 2) valor, max(n.dia) ultima,
    (array_agg(jsonb_build_object('cst', coalesce(i->>'cst', i->>'csosn'), 'aliquota', (i->'icms'->>'aliquota')::numeric,
      'cfop', i->>'cfop', 'cclasstrib', i->'ibscbs'->>'cclasstrib', 'ibscbs_cst', i->'ibscbs'->>'cst') order by n.dia desc))[1] nota,
    count(distinct coalesce(i->>'cst', '') || '|' || coalesce(i->'icms'->>'aliquota', '') || '|' || coalesce(i->>'cfop', '') || '|' || coalesce(i->'ibscbs'->>'cclasstrib', '')) classificacoes
  from public.nfce_notas n, jsonb_array_elements(n.itens) i
  where n.situacao = 'autorizada' and n.dia >= (now() at time zone 'America/Fortaleza')::date - 120 and not coalesce((i->>'cancelado')::boolean, false)
  group by 1, 2;
create unique index if not exists totvs_produtos_vendas_chave on public.totvs_produtos_vendas (unidade_id, codigo);
revoke all on public.totvs_produtos_vendas from public, anon, authenticated;
-- select cron.schedule('totvs-produtos-vendas', '*/30 * * * *', $$refresh materialized view concurrently public.totvs_produtos_vendas$$);

-- Lista (0,2 s): security definer, confere notas_pode_ver; os problemas são calculados na própria linha de cada produto.
-- (corpo aplicado pela migração totvs_produtos_lista_v2; resumo das regras: sem_ncm, sem_regra, pis ≠ 0,65, cofins ≠ 3
--  (CFOP 5102, não monofásico), monofásico com PIS/Cofins, regra do NCM com PIS/Cofins fora, ICMS/CFOP do produto ≠ regra,
--  regra sem IBS/CBS, classificação variando nas NFC-e, mesmo nome com NCM diferente entre as casas)

create or replace function public.totvs_produto_detalhe(p_loja int, p_codigo text)
returns jsonb language sql stable set search_path = public as $$
  with p as (
    select c.*, u.id unidade_id, coalesce(u.nome, c.loja_nome) casa
    from public.totvs_produtos_cadastro c left join public.totvs_unidades u on u.loja = c.loja_codigo and u.encerrada_em is null
    where c.loja_codigo = p_loja and c.codigo = p_codigo
  ),
  itens as (
    select n.dia, n.emissao, i
    from p join public.nfce_notas n on n.unidade_id = p.unidade_id, jsonb_array_elements(n.itens) i
    where n.situacao = 'autorizada' and i->>'codigo' = p_codigo and not coalesce((i->>'cancelado')::boolean, false)
  )
  select jsonb_build_object(
    'produto', (select to_jsonb(p) from p),
    'regra', (select to_jsonb(f) from public.totvs_regras_fiscais f, p where f.loja_codigo = p.loja_codigo and f.uf = 'RN' and f.regime = 'Regime Normal'
              and f.ncm = p.ncm order by (f.cest = coalesce(p.cest, '')) desc limit 1),
    'regras_ncm', (select jsonb_agg(jsonb_build_object('loja', coalesce(u.nome, f.loja_nome), 'uf', f.uf, 'regime', f.regime, 'cest', f.cest, 'icms', f.imposto,
                   'cst', f.cst, 'cfop', f.cfop, 'pis', f.pis_cst || ' · ' || f.pis_valor, 'cofins', f.cofins_cst || ' · ' || f.cofins_valor,
                   'ibscbs', coalesce(f.ibscbs_cst, '—') || ' · ' || coalesce(f.cclasstrib, '—')) order by f.loja_codigo)
                   from public.totvs_regras_fiscais f left join public.totvs_unidades u on u.loja = f.loja_codigo and u.encerrada_em is null, p where f.ncm = p.ncm),
    'outras_casas', (select jsonb_agg(jsonb_build_object('casa', coalesce(u.nome, c.loja_nome), 'codigo', c.codigo, 'nome', c.nome, 'situacao', c.situacao,
                     'ncm', c.ncm, 'cfop', c.cfop, 'icms', c.imposto, 'pis', c.pis, 'cofins', c.cofins, 'preco', c.preco) order by c.loja_codigo)
                     from public.totvs_produtos_cadastro c left join public.totvs_unidades u on u.loja = c.loja_codigo and u.encerrada_em is null, p
                     where c.loja_codigo <> p.loja_codigo and upper(trim(c.nome)) = upper(trim(p.nome))),
    'nota', (select jsonb_agg(x order by x.ultima desc) from (
               select coalesce(i->>'cst', i->>'csosn') cst, (i->'icms'->>'aliquota')::numeric aliquota, i->>'cfop' cfop, i->>'ncm' ncm,
                 i->'pis'->>'cst' pis_cst, (i->'pis'->>'aliquota')::numeric pis, i->'cofins'->>'cst' cofins_cst, (i->'cofins'->>'aliquota')::numeric cofins,
                 i->'ibscbs'->>'cst' ibscbs_cst, i->'ibscbs'->>'cclasstrib' cclasstrib, count(*) itens, max(dia) ultima, min(dia) primeira
               from itens group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10) x),
    'vendas_mes', (select jsonb_agg(x order by x.mes desc) from (
               select to_char(dia, 'YYYY-MM') mes, count(*) itens, round(sum((i->>'quantidade')::numeric), 2) qtd, round(sum((i->>'valor_total')::numeric), 2) valor,
                 round(sum(coalesce((i->'icms'->>'valor')::numeric, 0)), 2) icms
               from itens group by 1) x)
  )
$$;
revoke execute on function public.totvs_produto_detalhe(int, text) from public, anon;
grant execute on function public.totvs_produto_detalhe(int, text) to authenticated;
