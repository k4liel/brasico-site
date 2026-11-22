-- =====================================================================
-- Conferência fiscal das NFC-e (22/11/2026, pedido do dono a partir da ideia "agente que confere CFOP, CST e NCM item por
-- item"; aplica depois de nfce.sql). Confere todos os itens das NFC-e autorizadas de um período, por produto, com regras
-- fixas (sem IA, sem custo), e devolve os achados com o impacto estimado em R$.
--  - Regras (regra, severidade erro | atencao):
--      taxa_tributada     taxa de serviço/gorjeta com ICMS, PIS ou Cofins
--      taxa_ncm           taxa (serviço, rolha) com NCM de mercadoria
--      aliq_casas         mesma bebida alcoólica com alíquota de ICMS diferente entre as casas (ou diferente da decidida)
--      aliq_cafe          café/chá com alíquota diferente da comida da casa
--      ncm_casas          mesmo produto com NCM diferente entre as casas
--      ncm_prato          prato pronto com NCM de ingrediente (capítulos 03, 04, 07, 08, 16, 19, 20) ou diferente do decidido
--      unidade            prato com unidade CX
--      cst_cfop           CST 000 fora de 5102 ou CST 060 fora de 5405
--      icms_conta         base × alíquota diferente do ICMS destacado
--      pis_monofasico     água, refrigerante ou cerveja com PIS/Cofins tributado (CST 01)
--      variacao           o mesmo produto sai com NCM, CST, CFOP ou alíquota diferentes na mesma casa
--      cclass_vazio       itens com o grupo IBS/CBS sem cClassTrib (falha do caixa)
--      cclass_restaurante comida fora do 200047 (bares e restaurantes) ou diferente do decidido
--      cclass_casas       mesmo produto com cClassTrib diferente entre as casas
--      cclass_gorjeta     taxa de serviço fora do 410019 (gorjeta fora da base do IBS/CBS)
--  - Decisões da contabilidade em nfce_conferencia_regras (chave → valor): enquanto o valor é nulo a regra aponta
--    a inconsistência ("a definir"); com o valor decidido ela cobra o valor e calcula a diferença.
-- Quem vê: os sócios (nfce_notas tem RLS de notas_pode_ver; a função roda como quem chama).
-- =====================================================================

create table if not exists public.nfce_conferencia_regras (
  chave text primary key,
  nome text not null,
  valor text,                       -- nulo = a definir com a contabilidade
  decisao text,                     -- o que foi decidido e por quê
  definido_por text,
  definido_em date,
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);
insert into public.nfce_conferencia_regras (chave, nome, ordem) values
  ('taxa_servico_tributa', 'Taxa de serviço (gorjeta) é tributada? (sim / nao)', 1),
  ('icms_alcoolica', 'Alíquota de ICMS das bebidas alcoólicas (%)', 2),
  ('icms_cafe', 'Alíquota de ICMS de café e chá (%)', 3),
  ('ncm_prato', 'NCM padrão dos pratos prontos', 4),
  ('cclass_comida', 'cClassTrib da comida', 5),
  ('cclass_bebida', 'cClassTrib das bebidas não alcoólicas', 6),
  ('cclass_alcoolica', 'cClassTrib das bebidas alcoólicas', 7),
  ('cclass_taxa_servico', 'cClassTrib da taxa de serviço', 8)
on conflict (chave) do nothing;
alter table public.nfce_conferencia_regras enable row level security;
drop policy if exists "ver" on public.nfce_conferencia_regras;
create policy "ver" on public.nfce_conferencia_regras for select using (public.notas_pode_ver(auth.uid()));
revoke all on public.nfce_conferencia_regras from public, anon, authenticated;
grant select on public.nfce_conferencia_regras to authenticated;
drop trigger if exists nfce_conferencia_regras_sem_exclusao on public.nfce_conferencia_regras;
create trigger nfce_conferencia_regras_sem_exclusao before delete on public.nfce_conferencia_regras for each row execute function public.bloquear_exclusao();

create or replace function public.nfce_conferencia(p_de date, p_ate date, p_unidade text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare cfg jsonb; r jsonb;
begin
  select coalesce(jsonb_object_agg(chave, valor), '{}') into cfg from public.nfce_conferencia_regras;

  with it as (
    select n.unidade_id, n.chave_venda, n.numero, n.dia, i,
      upper(regexp_replace(trim(coalesce(i->>'nome', '')), '\s+', ' ', 'g')) nome_n
    from public.nfce_notas n, jsonb_array_elements(n.itens) i
    where n.situacao = 'autorizada' and n.dia between p_de and p_ate
      and not coalesce((i->>'cancelado')::boolean, false) and coalesce((i->>'valor_total')::numeric, 0) > 0
  ),
  -- Um registro por produto e casa, com a classificação mais comum e quantas variações teve
  p as (
    select unidade_id, i->>'codigo' cod, nome_n, max(i->>'nome') nome, mode() within group (order by i->>'grupo') grupo,
      mode() within group (order by i->>'ncm') ncm, mode() within group (order by i->>'cfop') cfop,
      mode() within group (order by i->>'cst') cst, mode() within group (order by i->'icms'->>'aliquota') aliq,
      mode() within group (order by i->'pis'->>'cst') pis_cst, mode() within group (order by i->>'unidade') un,
      mode() within group (order by i->'ibscbs'->>'cclasstrib') cclass,
      count(*) filter (where i->'ibscbs'->>'cclasstrib' is null) sem_cclass,
      count(distinct i->>'ncm') v_ncm, count(distinct i->>'cst') v_cst, count(distinct i->>'cfop') v_cfop, count(distinct i->'icms'->>'aliquota') v_aliq,
      count(*) itens, count(distinct chave_venda) notas, sum((i->>'valor_total')::numeric) valor,
      sum(coalesce((i->'icms'->>'base')::numeric, 0)) base_icms, sum(coalesce((i->'icms'->>'valor')::numeric, 0)) icms,
      sum(coalesce((i->'pis'->>'valor')::numeric, 0)) pis, sum(coalesce((i->'cofins'->>'valor')::numeric, 0)) cofins,
      count(*) filter (where abs(coalesce((i->'icms'->>'base')::numeric, 0) * coalesce((i->'icms'->>'aliquota')::numeric, 0) / 100
                                 - coalesce((i->'icms'->>'valor')::numeric, 0)) > 0.02) icms_errado,
      min(numero) exemplo
    from it group by 1, 2, 3
  ),
  q as (
    select p.*,
      p.nome_n ~ '(^| )(TX|TAXA)\.? ?(DE )?SERV|^SERVI[CÇ]O$|GORJETA' eh_taxa_servico,
      (p.nome_n ~ 'ROLHA' or p.grupo = 'TAXAS') eh_rolha,
      left(p.ncm, 4) in ('2204', '2205', '2206', '2207', '2208') eh_alcoolica,
      (left(p.ncm, 4) = '2101' or p.nome_n ~ '^(ESPRESSO|EXPRESSO|CAFE|CAF[ÉE] |CAPUC|CAPPUC|MACCHIATO|AMERICANO|CHA$|CHÁ$|CHA )') eh_cafe
    from p
  ),
  comida_aliq as (select unidade_id, mode() within group (order by aliq) aliq from q where grupo = 'COMIDA' and cst = '000' and not eh_taxa_servico group by 1),
  achados as (
    -- taxa de serviço tributada
    select 'taxa_tributada' regra, case when cfg->>'taxa_servico_tributa' = 'nao' then 'erro' else 'atencao' end sev, unidade_id, cod, nome,
      'ICMS / PIS / Cofins' campo, format('ICMS %s%% · PIS/Cofins CST %s', aliq, pis_cst) atual,
      case when cfg->>'taxa_servico_tributa' = 'nao' then 'sem ICMS, PIS e Cofins (decidido)' when cfg->>'taxa_servico_tributa' = 'sim' then 'tributada (decidido)'
        else 'a definir: a gorjeta costuma ficar fora da base (Lei 13.419/2017; Convênio ICMS 125/2011)' end esperado,
      itens, notas, valor, round(icms + pis + cofins, 2) impacto, 'pago' sentido, exemplo
    from q where eh_taxa_servico and (icms + pis + cofins) > 0 and coalesce(cfg->>'taxa_servico_tributa', '') <> 'sim'
    union all
    -- taxa com NCM de mercadoria
    select 'taxa_ncm', 'erro', unidade_id, cod, nome, 'NCM', ncm, 'taxa não é mercadoria: NCM a definir com a contabilidade',
      itens, notas, valor, case when eh_taxa_servico then null else round(icms, 2) end, case when eh_taxa_servico then null else 'pago' end, exemplo
    from q where (eh_taxa_servico or eh_rolha) and ncm ~ '^[0-9]{8}$' and ncm not like '00%'
    union all
    -- alíquota das bebidas alcoólicas: diferente da decidida, ou diferente entre as casas
    select 'aliq_casas', 'erro', a.unidade_id, a.cod, a.nome, 'Alíquota de ICMS', a.aliq || '%',
      case when cfg->>'icms_alcoolica' is not null then (cfg->>'icms_alcoolica') || '% (decidido)'
        else (select string_agg(distinct b.aliq || '% em outra casa', ', ') from q b where b.eh_alcoolica and b.cst = '000' and b.unidade_id <> a.unidade_id) end,
      a.itens, a.notas, a.valor,
      round(a.base_icms * abs(coalesce((cfg->>'icms_alcoolica')::numeric,
        (select max(b.aliq::numeric) from q b where b.eh_alcoolica and b.cst = '000' and b.unidade_id <> a.unidade_id)) - a.aliq::numeric) / 100, 2),
      case when coalesce((cfg->>'icms_alcoolica')::numeric, (select max(b.aliq::numeric) from q b where b.eh_alcoolica and b.cst = '000' and b.unidade_id <> a.unidade_id)) > a.aliq::numeric
        then 'a_menos' else 'pago' end, a.exemplo
    from q a where a.eh_alcoolica and a.cst = '000' and a.aliq is not null
      and ((cfg->>'icms_alcoolica' is not null and a.aliq::numeric <> (cfg->>'icms_alcoolica')::numeric)
        or (cfg->>'icms_alcoolica' is null and exists (select 1 from q b where b.eh_alcoolica and b.cst = '000' and b.unidade_id <> a.unidade_id and b.aliq <> a.aliq)))
    union all
    -- café e chá com alíquota diferente da comida da casa (ou da decidida)
    select 'aliq_cafe', 'atencao', a.unidade_id, a.cod, a.nome, 'Alíquota de ICMS', a.aliq || '%',
      coalesce((cfg->>'icms_cafe') || '% (decidido)', c.aliq || '% (como a comida da casa)'), a.itens, a.notas, a.valor,
      round(a.base_icms * abs(a.aliq::numeric - coalesce((cfg->>'icms_cafe')::numeric, c.aliq::numeric)) / 100, 2),
      case when a.aliq::numeric > coalesce((cfg->>'icms_cafe')::numeric, c.aliq::numeric) then 'pago' else 'a_menos' end, a.exemplo
    from q a join comida_aliq c using (unidade_id)
    where a.eh_cafe and a.cst = '000' and a.aliq is not null and a.aliq::numeric <> coalesce((cfg->>'icms_cafe')::numeric, c.aliq::numeric)
    union all
    -- mesmo produto com NCM diferente entre as casas
    select 'ncm_casas', 'atencao', a.unidade_id, a.cod, a.nome, 'NCM', a.ncm,
      (select string_agg(distinct b.ncm || ' em outra casa', ', ') from q b where b.nome_n = a.nome_n and b.unidade_id <> a.unidade_id and b.ncm <> a.ncm),
      a.itens, a.notas, a.valor, null, null, a.exemplo
    from q a where not a.eh_taxa_servico and exists (select 1 from q b where b.nome_n = a.nome_n and b.unidade_id <> a.unidade_id and b.ncm <> a.ncm)
    union all
    -- prato pronto com NCM de ingrediente (ou diferente do decidido)
    select 'ncm_prato', case when cfg->>'ncm_prato' is not null then 'erro' else 'atencao' end, unidade_id, cod, nome, 'NCM', ncm,
      coalesce((cfg->>'ncm_prato') || ' (decidido)', 'NCM de prato pronto (a definir; o Filha da Lua usa 21069090)'),
      itens, notas, valor, null, null, exemplo
    from q where grupo = 'COMIDA' and not eh_taxa_servico and not eh_rolha
      and ((cfg->>'ncm_prato' is not null and ncm <> cfg->>'ncm_prato')
        or (cfg->>'ncm_prato' is null and left(ncm, 2) in ('03', '04', '07', '08', '16', '19', '20')))
    union all
    -- prato com unidade CX
    select 'unidade', 'atencao', unidade_id, cod, nome, 'Unidade', un, 'UN (porção)', itens, notas, valor, null, null, exemplo
    from q where grupo = 'COMIDA' and un = 'CX'
    union all
    -- CST × CFOP
    select 'cst_cfop', 'erro', unidade_id, cod, nome, 'CST × CFOP', cst || ' com ' || cfop,
      case when cst = '000' then '000 com 5102' else '060 com 5405' end, itens, notas, valor, null, null, exemplo
    from q where (cst = '000' and cfop <> '5102') or (cst = '060' and cfop <> '5405')
    union all
    -- conta do ICMS
    select 'icms_conta', 'erro', unidade_id, cod, nome, 'ICMS destacado', icms_errado || ' itens com a conta errada',
      'base × alíquota = ICMS', icms_errado, notas, valor, null, null, exemplo
    from q where icms_errado > 0
    union all
    -- PIS/Cofins de bebida fria monofásica
    select 'pis_monofasico', 'erro', unidade_id, cod, nome, 'PIS/Cofins', 'CST ' || pis_cst || ' (tributado)',
      'CST 04 ou 06 (monofásico: já pago pelo fabricante)', itens, notas, valor, round(pis + cofins, 2), 'pago', exemplo
    from q where (left(ncm, 4) in ('2201', '2202', '2203') or ncm like '2106901%') and pis_cst = '01' and (pis + cofins) > 0
    union all
    -- o mesmo produto varia de classificação na mesma casa
    select 'variacao', 'atencao', unidade_id, cod, nome, 'Classificação',
      concat_ws(' · ', case when v_ncm > 1 then v_ncm || ' NCM' end, case when v_cst > 1 then v_cst || ' CST' end,
        case when v_cfop > 1 then v_cfop || ' CFOP' end, case when v_aliq > 1 then v_aliq || ' alíquotas' end),
      'uma classificação só por produto', itens, notas, valor, null, null, exemplo
    from q where v_ncm > 1 or v_cst > 1 or v_cfop > 1 or v_aliq > 1
    union all
    -- cClassTrib vazio
    select 'cclass_vazio', 'erro', unidade_id, cod, nome, 'cClassTrib', sem_cclass || ' de ' || itens || ' itens sem classificação',
      'todo item com CST e cClassTrib de IBS/CBS', sem_cclass, notas, valor, null, null, exemplo
    from q where sem_cclass > 0
    union all
    -- comida fora do 200047 (ou do decidido)
    select 'cclass_restaurante', 'atencao', unidade_id, cod, nome, 'cClassTrib', cclass,
      coalesce((cfg->>'cclass_comida') || ' (decidido)', '200047 (bares e restaurantes, 40% de redução; a confirmar)'),
      itens, notas, valor, null, null, exemplo
    from q where grupo = 'COMIDA' and not eh_taxa_servico and not eh_rolha and cclass is not null
      and cclass <> coalesce(cfg->>'cclass_comida', '200047')
    union all
    -- cClassTrib diferente entre as casas
    select 'cclass_casas', 'atencao', a.unidade_id, a.cod, a.nome, 'cClassTrib', a.cclass,
      (select string_agg(distinct b.cclass || ' em outra casa', ', ') from q b where b.nome_n = a.nome_n and b.unidade_id <> a.unidade_id and b.cclass <> a.cclass),
      a.itens, a.notas, a.valor, null, null, a.exemplo
    from q a where a.cclass is not null and exists (select 1 from q b where b.nome_n = a.nome_n and b.unidade_id <> a.unidade_id and b.cclass is not null and b.cclass <> a.cclass)
    union all
    -- taxa de serviço fora do 410019
    select 'cclass_gorjeta', 'atencao', unidade_id, cod, nome, 'cClassTrib', coalesce(cclass, 'vazio'),
      coalesce((cfg->>'cclass_taxa_servico') || ' (decidido)', '410019 (gorjeta fora da base do IBS/CBS)'), itens, notas, valor, null, null, exemplo
    from q where eh_taxa_servico and coalesce(cclass, '') <> coalesce(cfg->>'cclass_taxa_servico', '410019')
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'itens', (select count(*) from it where p_unidade is null or it.unidade_id = p_unidade),
    'produtos', (select count(*) from p where p_unidade is null or p.unidade_id = p_unidade),
    'achados', coalesce((select jsonb_agg(to_jsonb(a) order by (a.sev = 'erro') desc, a.impacto desc nulls last, a.valor desc)
                         from achados a where p_unidade is null or a.unidade_id = p_unidade), '[]'),
    'regras', (select jsonb_agg(to_jsonb(x) order by x.ordem) from public.nfce_conferencia_regras x)
  ) into r;
  return r;
end $$;
revoke execute on function public.nfce_conferencia(date, date, text) from public, anon;
grant execute on function public.nfce_conferencia(date, date, text) to authenticated;
