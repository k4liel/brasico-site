-- =====================================================================
-- Regras fiscais da TOTVS (Chef Web) e a conferência delas (22/11/2026, pedido do dono: "entre na TOTVS... em produtos
-- tem todas as informações: mostre o que tá errado e como resolver")
-- No Chef Web a tributação de cada produto vem da regra fiscal do NCM dele, por loja, UF e regime (Relatórios → Fiscal →
-- "Relatório de Regras Fiscais", /Relatorios/RelatorioRegraFiscal/). A API RegraFiscal/ConsultarRegras responde código 20
-- para o usuário da integração; a primeira cópia (108 regras) foi lida da tela com o login do dono, em 22/11/2026.
-- Os dados não ficam neste arquivo (repositório público): só a estrutura e a conferência.
-- =====================================================================

create table if not exists public.totvs_regras_fiscais (
  loja_codigo int not null,
  loja_nome text,
  uf text not null,
  regime text not null,
  ncm text not null,
  cest text not null default '',
  tributo text, imposto numeric, tipo_item text, cfop text, cst text, csosn text,
  red_bc numeric, fcp numeric, cod_beneficio text, red_icms_efet numeric, aliq_icms_efet numeric,
  pis_cst text, pis_valor numeric, pis_calculo text, cofins_cst text, cofins_valor numeric, cofins_calculo text,
  servico_abrasf text, exig_iss text, incentivo text, nat_issqn text, cod_cred_presumido text, cred_presumido numeric,
  ibscbs_cst text, cclasstrib text, cbs numeric, ibs_uf numeric, ibs_mun numeric, red_cbs numeric, red_ibs numeric,
  lido_em timestamptz not null default now(),
  fonte text not null default 'relatorio_regras_fiscais',
  primary key (loja_codigo, uf, regime, ncm, cest)
);
alter table public.totvs_regras_fiscais enable row level security;
drop policy if exists "ver" on public.totvs_regras_fiscais;
create policy "ver" on public.totvs_regras_fiscais for select using (public.notas_pode_ver(auth.uid()));
revoke all on public.totvs_regras_fiscais from public, anon, authenticated;
grant select on public.totvs_regras_fiscais to authenticated;

-- totvs_regras_fiscais_gravar(texto, fonte): grava as linhas do relatório (36 colunas separadas por |, na ordem da tela:
-- UF, Regime, Loja, Cód. Loja, NCM, CEST, Tributo, Imposto, Tipo de Item, CFOP, CST, CSOSN, Red. BC, FCP, Benefício,
-- Red. ICMS efet., Alíq. ICMS efet., PIS (cód, valor, cálculo), COFINS (cód, valor, cálculo), Abrasf, Exig. ISS,
-- Incentivo, Nat. ISSQN, Créd. presumido (cód, %), CST IBS/CBS, cClassTrib, CBS, IBS UF, IBS Mun, Red. CBS, Red. IBS).
-- (corpo aplicado no banco pela migração totvs_regras_fiscais)

create or replace function public.totvs_regras_conferencia()
returns jsonb language sql stable set search_path = public as $$
  with r as (
    select f.*, u.id unidade_id, coalesce(u.nome, f.loja_nome) casa
    from public.totvs_regras_fiscais f left join public.totvs_unidades u on u.loja = f.loja_codigo and u.encerrada_em is null
  ),
  vendidos as (
    -- NCM de cada produto vendido nos últimos 120 dias, por loja (pelas NFC-e)
    select u.loja loja_codigo, n.unidade_id, i->>'ncm' ncm, count(distinct coalesce(i->>'codigo', i->>'nome')) produtos,
      (array_agg(distinct i->>'nome'))[1:4] exemplos, round(sum((i->>'valor_total')::numeric), 2) valor
    from public.nfce_notas n join public.totvs_unidades u on u.id = n.unidade_id, jsonb_array_elements(n.itens) i
    where n.situacao = 'autorizada' and n.dia >= (now() at time zone 'America/Fortaleza')::date - 120 and coalesce(i->>'ncm', '') <> ''
    group by 1, 2, 3
  ),
  achados as (
    select 'uf' regra, 'erro' sev, loja_codigo, casa, ncm, cest, 'UF da regra' campo, uf atual, 'RN' esperado from r where uf <> 'RN'
    union all
    select 'regime', 'atencao', loja_codigo, casa, ncm, cest, 'Regime', regime, 'Regime Normal (a Brasico77 é do Lucro Presumido)'
    from r where regime <> 'Regime Normal'
    union all
    select 'pis', 'erro', loja_codigo, casa, ncm, cest, 'PIS', pis_cst || ' · ' || pis_valor || '%', '0,65% (cumulativo do Lucro Presumido)'
    from r where uf = 'RN' and pis_cst = '01' and pis_valor is distinct from 0.65
    union all
    select 'cofins', 'erro', loja_codigo, casa, ncm, cest, 'Cofins', cofins_cst || ' · ' || cofins_valor || coalesce(' ' || lower(cofins_calculo), ''),
      '3,00% (cumulativo do Lucro Presumido)'
    from r where uf = 'RN' and ((cofins_cst = '01' and cofins_valor is distinct from 3.00) or cofins_cst = '03')
    union all
    select 'monofasico', 'erro', loja_codigo, casa, ncm, cest, 'PIS/Cofins', pis_cst || ' / ' || cofins_cst, '04 ou 06 (bebida monofásica: sem PIS/Cofins na venda)'
    from r where uf = 'RN' and (ncm like '2201%' or ncm like '2202%' or ncm like '2203%') and (pis_cst not in ('04', '06') or cofins_cst not in ('04', '06'))
    union all
    select 'monofasico_cst', 'atencao', loja_codigo, casa, ncm, cest, 'PIS/Cofins', pis_cst || ' / ' || cofins_cst, 'mesmo CST nas casas (04 = monofásico; 06 = alíquota zero)'
    from r where uf = 'RN' and pis_cst = '04' and exists (select 1 from r x where x.ncm = r.ncm and x.uf = 'RN' and x.pis_cst = '06' and x.loja_codigo <> r.loja_codigo)
    union all
    select 'ibscbs', 'atencao', loja_codigo, casa, ncm, cest, 'IBS/CBS', coalesce(ibscbs_cst, 'vazio') || ' · ' || coalesce(cclasstrib, 'vazio'), 'CST e cClassTrib preenchidos'
    from r where ibscbs_cst is null or cclasstrib is null
    union all
    select 'tipo_item', 'atencao', loja_codigo, casa, ncm, cest, 'Tipo do item', 'vazio', '00 (mercadoria para revenda)' from r where tipo_item is null
    union all
    select 'st_sem_cest', 'atencao', loja_codigo, casa, ncm, cest, 'CEST', 'vazio', 'CEST do produto com substituição tributária' from r where cst = '060' and cest = ''
    union all
    select 'casas', 'atencao', a.loja_codigo, a.casa, a.ncm, a.cest, 'Diferente entre as casas',
      'ICMS ' || a.imposto || '% · CST ' || a.cst || ' · PIS ' || a.pis_valor || ' · Cofins ' || a.cofins_valor || ' · ' || coalesce(a.cclasstrib, '—'),
      b.casa || ': ICMS ' || b.imposto || '% · CST ' || b.cst || ' · PIS ' || b.pis_valor || ' · Cofins ' || b.cofins_valor || ' · ' || coalesce(b.cclasstrib, '—')
    from r a join r b on b.ncm = a.ncm and b.cest = a.cest and b.uf = 'RN' and a.uf = 'RN' and b.regime = a.regime and b.loja_codigo > a.loja_codigo
      and a.unidade_id is not null and b.unidade_id is not null
    where (a.imposto, a.cst, a.pis_cst, a.pis_valor, a.cofins_cst, a.cofins_valor, coalesce(a.cclasstrib, ''))
      is distinct from (b.imposto, b.cst, b.pis_cst, b.pis_valor, b.cofins_cst, b.cofins_valor, coalesce(b.cclasstrib, ''))
    union all
    select 'sem_regra', 'erro', v.loja_codigo, coalesce(u.nome, v.unidade_id), v.ncm, '', 'Regra fiscal do NCM',
      'nenhuma regra para o NCM nesta loja (' || v.produtos || ' produto(s) vendidos: ' || array_to_string(v.exemplos, ', ') || ')',
      'cadastrar a regra fiscal do NCM na loja (Chef Web)'
    from vendidos v join public.totvs_unidades u on u.id = v.unidade_id
    where not exists (select 1 from public.totvs_regras_fiscais f where f.loja_codigo = v.loja_codigo and f.ncm = v.ncm and f.uf = 'RN')
  )
  select jsonb_build_object(
    'lido_em', (select max(lido_em) from public.totvs_regras_fiscais),
    'regras', (select count(*) from public.totvs_regras_fiscais),
    'lojas', (select jsonb_agg(distinct jsonb_build_object('codigo', loja_codigo, 'nome', loja_nome)) from public.totvs_regras_fiscais),
    'achados', coalesce((select jsonb_agg(to_jsonb(a) order by (a.sev = 'erro') desc, a.regra, a.loja_codigo, a.ncm) from achados a), '[]'),
    'lista', coalesce((select jsonb_agg(to_jsonb(f) order by f.loja_codigo, f.ncm, f.cest) from public.totvs_regras_fiscais f), '[]')
  )
$$;
revoke execute on function public.totvs_regras_conferencia() from public, anon;
grant execute on function public.totvs_regras_conferencia() to authenticated;
