-- =====================================================================
-- Cadastro completo dos produtos do Chef Web e a conferência dele (22/11/2026, pedido do dono: "busque tudo agora, os
-- dados não vão mudar; quando mudar eu busco novamente")
-- A leitura é feita do navegador do sócio, com a sessão dele no Chef Web: a página Cadastros/ProdutoServico é percorrida
-- (todas as páginas da grade) e a tela de cada produto (Edit?id=<código>) é lida e enviada por
-- chefweb_importar_produtos(chave, loja, nome, produtos), que só aceita uma chave temporária (chefweb_importacao_chaves:
-- só o hash, vale 3 horas). Para reler: pedir ao Claude, com o Chef Web aberto no navegador do app.
-- O robô (robos/chefweb, supabase/chefweb_robo.sql) ficou pronto mas desligado: o dono preferiu buscar à mão.
-- =====================================================================

create or replace function public.totvs_cadastro_conferencia()
returns jsonb language sql stable set search_path = public as $$
  with p as (
    select c.*, u.id unidade_id, coalesce(u.nome, c.loja_nome) casa
    from public.totvs_produtos_cadastro c left join public.totvs_unidades u on u.loja = c.loja_codigo and u.encerrada_em is null
    where c.situacao ilike 'ATIVO%' and coalesce(c.grupo, '') not ilike '%ESTOQUE%' -- insumos (COMIDA/BEBIDA ESTOQUE) não são vendidos
  ),
  vendidos as (
    select n.unidade_id, i->>'codigo' codigo, count(*) itens, round(sum((i->>'valor_total')::numeric), 2) valor, max(n.dia) ultima
    from public.nfce_notas n, jsonb_array_elements(n.itens) i
    where n.situacao = 'autorizada' and n.dia >= (now() at time zone 'America/Fortaleza')::date - 120
    group by 1, 2
  ),
  base as (
    select p.*, r.imposto regra_imposto, r.cst regra_cst, r.cfop regra_cfop, r.pis_cst regra_pis_cst, r.pis_valor regra_pis, r.cofins_cst regra_cofins_cst,
      r.cofins_valor regra_cofins, r.cclasstrib regra_cclasstrib, (r.ncm is not null) tem_regra,
      v.itens vendas_itens, v.valor vendas_valor, v.ultima vendas_ultima,
      (p.ncm like '2201%' or p.ncm like '2202%' or p.ncm like '2203%') monofasico
    from p
    left join lateral (select * from public.totvs_regras_fiscais f where f.loja_codigo = p.loja_codigo and f.uf = 'RN' and f.regime = 'Regime Normal'
                       and f.ncm = p.ncm order by (f.cest = coalesce(p.cest, '')) desc, f.cest limit 1) r on true
    left join vendidos v on v.unidade_id = p.unidade_id and v.codigo = p.codigo
  ),
  achados as (
    select 'sem_ncm' regra, 'erro' sev, b.* from base b where coalesce(ncm, '') !~ '^[0-9]{8}$'
    union all
    select 'sem_regra', 'erro', b.* from base b where ncm ~ '^[0-9]{8}$' and not tem_regra
    union all
    select 'icms_regra', 'atencao', b.* from base b where tem_regra and imposto is not null and regra_imposto is not null and imposto <> regra_imposto
    union all
    select 'cfop_regra', 'atencao', b.* from base b where tem_regra and coalesce(cfop, '') <> '' and regra_cfop is not null and cfop <> regra_cfop
    union all
    select 'pis', 'erro', b.* from base b where not monofasico and coalesce(cfop, '') = '5102' and pis is not null and pis not in (0.65)
    union all
    select 'cofins', 'erro', b.* from base b where not monofasico and coalesce(cfop, '') = '5102' and cofins is not null and cofins not in (3.00)
    union all
    select 'monofasico', 'erro', b.* from base b where monofasico and (coalesce(pis, 0) > 0 or coalesce(cofins, 0) > 0)
    union all
    select 'ncm_casas', 'atencao', b.* from base b
    where exists (select 1 from base x where x.loja_codigo <> b.loja_codigo and upper(trim(x.nome)) = upper(trim(b.nome)) and coalesce(x.ncm, '') <> coalesce(b.ncm, ''))
  )
  select jsonb_build_object(
    'lido_em', (select max(lido_em) from public.totvs_produtos_cadastro),
    'lojas', coalesce((select jsonb_agg(x) from (select loja_codigo, max(loja_nome) loja_nome, count(*) produtos,
        count(*) filter (where situacao ilike 'ATIVO%') ativos, max(lido_em) lido_em from public.totvs_produtos_cadastro group by 1 order by 1) x), '[]'),
    'achados', coalesce((select jsonb_agg(jsonb_build_object('regra', a.regra, 'sev', a.sev, 'loja_codigo', a.loja_codigo, 'casa', a.casa, 'codigo', a.codigo,
        'nome', a.nome, 'grupo', a.grupo, 'ncm', a.ncm, 'cest', a.cest, 'cfop', a.cfop, 'imposto', a.imposto, 'pis', a.pis, 'cofins', a.cofins,
        'regra_imposto', a.regra_imposto, 'regra_cfop', a.regra_cfop, 'regra_cst', a.regra_cst, 'vendas_valor', a.vendas_valor, 'vendas_ultima', a.vendas_ultima)
        order by (a.sev = 'erro') desc, a.regra, (a.vendas_valor is null), a.vendas_valor desc nulls last, a.loja_codigo, a.nome) from achados a), '[]'),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('loja_codigo', b.loja_codigo, 'casa', b.casa, 'codigo', b.codigo, 'nome', b.nome, 'grupo', b.grupo,
        'subgrupo', b.subgrupo, 'preco', b.preco, 'ncm', b.ncm, 'cest', b.cest, 'cfop', b.cfop, 'imposto', b.imposto, 'pis', b.pis, 'cofins', b.cofins,
        'regra_imposto', b.regra_imposto, 'regra_cst', b.regra_cst, 'regra_cclasstrib', b.regra_cclasstrib, 'tem_regra', b.tem_regra,
        'vendas_valor', b.vendas_valor, 'vendas_ultima', b.vendas_ultima)
        order by b.loja_codigo, (b.vendas_valor is null), b.vendas_valor desc nulls last, b.nome) from base b), '[]')
  )
$$;
revoke execute on function public.totvs_cadastro_conferencia() from public, anon;
grant execute on function public.totvs_cadastro_conferencia() to authenticated;
