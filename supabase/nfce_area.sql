-- =====================================================================
-- Área de NFC-e com menu lateral (23/11/2026, prévia "A · lateral" escolhida pelo dono)
-- Visões: Visão geral · Notas · Produtos · Impostos do mês · Pendências · Reforma 2027 (components/NfceArea.tsx).
-- nfce_visao_geral(mes) → séries por mês, cada casa no mês, pendências e "o que fazer agora" com o impacto em R$.
-- nfce_pendencias()     → tudo o que precisa corrigir, por quem resolve (Chef Web, contabilidade, acompanhar).
-- nfce_reforma(meses)   → como os itens vendidos saem na classificação da reforma (cClassTrib) por casa e categoria,
--                         e o PIS/Cofins do período, para comparar com a CBS de 2027.
-- Todas security definer e conferem notas_pode_ver. Leem as vistas prontas (nfce_meses, nfce_produtos_mes) e o
-- cadastro do Chef Web (totvs_produtos_lista, totvs_regras_conferencia).
-- =====================================================================

create or replace function public.nfce_categoria(p_grupo text, p_nome text)
returns text language sql immutable as $$
  select case
    when upper(coalesce(p_nome, '')) ~ '^(TX\.? ?SERV|TAXA (DE )?SERV)' or upper(coalesce(p_grupo, '')) like '%TAXA%' then 'taxa'
    when upper(coalesce(p_grupo, '')) like '%BEBIDA%' then 'bebida'
    when upper(coalesce(p_grupo, '')) like '%COMIDA%' then 'comida'
    else 'outros' end
$$;

create or replace function public.nfce_visao_geral(p_mes text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_ant text := to_char((p_mes || '-01')::date - interval '1 month', 'YYYY-MM');
  v_prod jsonb; v_regras jsonb;
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'sem acesso'; end if;
  v_prod := public.totvs_produtos_lista(false);
  v_regras := public.totvs_regras_conferencia();
  with casas as (
    select u.id, u.nome, u.loja, coalesce(u.ordem, 99) ordem from public.totvs_unidades u
    where u.encerrada_em is null and u.loja is not null and (u.ativa or exists (select 1 from public.nfce_meses m where m.unidade_id = u.id))
  ),
  prods as (select (p->>'l')::int loja, x->>'regra' regra, x->>'sev' sev, p->>'n' nome
            from jsonb_array_elements(v_prod->'produtos') p, jsonb_array_elements(p->'pb') x where (p->>'a')::boolean),
  prod_sit as (select (p->>'l')::int loja, case when exists (select 1 from jsonb_array_elements(p->'pb') x where x->>'sev' = 'erro') then 'erro'
                 when jsonb_array_length(p->'pb') > 0 then 'atencao' else 'ok' end sit
               from jsonb_array_elements(v_prod->'produtos') p where (p->>'a')::boolean),
  doze as (select * from public.nfce_produtos_mes where mes > to_char((p_mes || '-01')::date - interval '12 months', 'YYYY-MM') and mes <= p_mes),
  taxa as (select coalesce(sum(m.icms), 0) icms, coalesce(sum(m.valor), 0) valor from public.nfce_produtos_mes m
           join public.totvs_unidades u on u.id = m.unidade_id
           join public.totvs_produtos_cadastro c on c.loja_codigo = u.loja and c.codigo = m.codigo
           where m.mes = p_mes and public.nfce_categoria(c.grupo, c.nome) = 'taxa'),
  reforma as (select count(*) filter (where cclasstrib = '200047') c200047, sum(itens) itens,
                sum(itens) filter (where cclasstrib = '200047') i200047, sum(itens) filter (where cclasstrib = '000001') i000001,
                sum(itens) filter (where cclasstrib = '410019') i410019, sum(itens) filter (where cclasstrib is null) ivazio
              from public.nfce_produtos_mes where mes = p_mes)
  select jsonb_build_object(
    'mes', p_mes,
    'meses', coalesce((select jsonb_agg(x order by x.mes) from (select mes, sum(valor) valor, sum(notas) notas, sum(icms) icms, sum(pis) + sum(cofins) piscofins,
              sum(valor_sem_nota) sem_nota from public.nfce_meses group by mes) x), '[]'),
    'casas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'loja', c.loja,
              'notas', coalesce(m.notas, 0), 'valor', coalesce(m.valor, 0), 'sem_nota', coalesce(m.valor_sem_nota, 0), 'pendentes', coalesce(m.pendentes, 0),
              'canceladas', coalesce(m.canceladas, 0), 'icms', coalesce(m.icms, 0), 'pis', coalesce(m.pis, 0), 'cofins', coalesce(m.cofins, 0),
              'cbs', coalesce(m.cbs, 0), 'ibs', coalesce(m.ibs, 0), 'servico', coalesce(m.servico, 0), 'valor_ant', coalesce(a.valor, 0),
              'erros', (select count(*) from prod_sit s where s.loja = c.loja and s.sit = 'erro'),
              'atencoes', (select count(*) from prod_sit s where s.loja = c.loja and s.sit = 'atencao'),
              'desde', (select min(dia) from public.nfce_notas n where n.unidade_id = c.id)) order by c.ordem)
              from casas c left join (select unidade_id, sum(notas) notas, sum(valor) valor, sum(valor_sem_nota) valor_sem_nota, sum(pendentes) pendentes,
                sum(canceladas) canceladas, sum(icms) icms, sum(pis) pis, sum(cofins) cofins, sum(cbs) cbs, sum(ibs) ibs, sum(servico) servico
                from public.nfce_meses where mes = p_mes group by 1) m on m.unidade_id = c.id
              left join (select unidade_id, sum(valor) valor from public.nfce_meses where mes = v_ant group by 1) a on a.unidade_id = c.id), '[]'),
    'pendencias', jsonb_build_object(
      'produtos_erro', (select count(*) from prod_sit where sit = 'erro'),
      'produtos_atencao', (select count(*) from prod_sit where sit = 'atencao'),
      'produtos_ok', (select count(*) from prod_sit where sit = 'ok'),
      'regras_erro', (select count(*) from jsonb_array_elements(v_regras->'achados') a where a->>'sev' = 'erro'),
      'decisoes', (select count(*) from public.nfce_conferencia_regras where valor is null) + (select count(*) from public.icms_regras where valor is null)),
    'reforma', (select to_jsonb(reforma) from reforma),
    'fazer', coalesce((select jsonb_agg(f order by f.ordem) from (
      select 1 ordem, 'erro' sev, 'Cofins abaixo de 3% em ' || count(distinct codigo) || ' produtos' titulo,
        'recolhido a menos em 12 meses · corrigir no Chef Web (produto e regra do NCM)' detalhe,
        round(sum(valor * (3 - cofins) / 100), 2) valor, 'produtos' vista, 'cofins' filtro
      from doze where cofins_cst = '01' and cofins < 3 and cfop = '5102' having count(*) > 0
      union all
      select 2, 'erro', 'PIS abaixo de 0,65% em ' || count(distinct codigo) || ' produtos', 'recolhido a menos em 12 meses · regra do NCM',
        round(sum(valor * (0.65 - pis) / 100), 2), 'produtos', 'pis'
      from doze where pis_cst = '01' and pis < 0.65 and cfop = '5102' having count(*) > 0
      union all
      select 3, 'atencao', 'Taxa de serviço saindo com ICMS', 'ICMS no mês sobre a gorjeta · decisão da contabilidade (Lei 13.419/2017)',
        t.icms, 'pendencias', 'contabilidade' from taxa t where t.icms > 0
      union all
      select 4, 'atencao', 'Mesmo NCM com regra diferente entre as casas', count(*) || ' NCMs · igualar a regra fiscal (alíquota, PIS/Cofins, cClassTrib)',
        null, 'pendencias', 'regras' from jsonb_array_elements(v_regras->'achados') a where a->>'regra' = 'casas' having count(*) > 0
      union all
      select 5, 'atencao', 'Itens fora da classificação de restaurante (200047)',
        round(100.0 * coalesce(rf.i000001, 0) / nullif(rf.itens, 0)) || '% dos itens saem como tributação integral (000001) · reforma: 40% de redução em 2027',
        null, 'reforma', null from reforma rf where coalesce(rf.i000001, 0) > 0
      union all
      select 6, 'erro', 'Regra fiscal com UF errada', count(*) || ' regra(s) cadastrada(s) para fora do RN', null, 'pendencias', 'regras'
      from jsonb_array_elements(v_regras->'achados') a where a->>'regra' = 'uf' having count(*) > 0
      union all
      select 7, 'erro', 'NCM sem regra fiscal na casa', count(*) || ' produto(s) ativo(s)', null, 'produtos', 'sem_regra'
      from prods where regra = 'sem_regra' having count(*) > 0
    ) f), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.nfce_visao_geral(text) from public, anon;
grant execute on function public.nfce_visao_geral(text) to authenticated;

create or replace function public.nfce_pendencias()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_prod jsonb; v_regras jsonb; v_mes text := to_char((now() at time zone 'America/Fortaleza'), 'YYYY-MM');
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'sem acesso'; end if;
  v_prod := public.totvs_produtos_lista(false);
  v_regras := public.totvs_regras_conferencia();
  with casas as (select loja_codigo l, casa from jsonb_to_recordset(v_prod->'casas') as x(loja_codigo int, casa text)),
  pb as (select (p->>'l')::int l, x->>'regra' regra, x->>'sev' sev, p->>'n' nome, p->>'c' codigo, coalesce((p->>'v_val')::numeric, 0) vendido
         from jsonb_array_elements(v_prod->'produtos') p, jsonb_array_elements(p->'pb') x where (p->>'a')::boolean)
  select jsonb_build_object(
    'chefweb_produtos', coalesce((select jsonb_agg(x order by (x.sev = 'erro') desc, x.vendido desc, x.produtos desc) from (
        select pb.regra, pb.sev, pb.l loja, c.casa, count(*) produtos, round(sum(vendido), 2) vendido,
          (array_agg(pb.nome order by vendido desc))[1:5] exemplos
        from pb left join casas c on c.l = pb.l group by 1, 2, 3, 4) x), '[]'),
    'chefweb_regras', coalesce((select jsonb_agg(x order by (x.sev = 'erro') desc, x.regras desc) from (
        select a->>'regra' regra, a->>'sev' sev, count(*) regras, array_agg(distinct a->>'casa') casas,
          (array_agg(a->>'ncm' || ' · ' || (a->>'casa') || ': ' || (a->>'atual')))[1:4] exemplos
        from jsonb_array_elements(v_regras->'achados') a group by 1, 2) x), '[]'),
    'decisoes', coalesce((select jsonb_agg(x) from (
        select 'nfce' origem, chave, nome, valor, decisao from public.nfce_conferencia_regras
        union all select 'icms', chave, nome, valor, decisao from public.icms_regras) x), '[]'),
    'acompanhar', jsonb_build_object(
      'pendentes_mes', (select coalesce(sum(pendentes), 0) from public.nfce_meses where mes = v_mes),
      'canceladas_mes', (select coalesce(sum(canceladas), 0) from public.nfce_meses where mes = v_mes),
      'casas', coalesce((select jsonb_agg(jsonb_build_object('nome', u.nome, 'desde', (select min(dia) from public.nfce_notas n where n.unidade_id = u.id),
                 'ate', (select max(dia) from public.nfce_notas n where n.unidade_id = u.id)) order by u.ordem)
               from public.totvs_unidades u where u.encerrada_em is null and u.loja is not null and u.ativa), '[]'),
      'cadastro_lido', v_prod->>'lido_em', 'regras_lidas', v_regras->>'lido_em')
  ) into r;
  return r;
end $$;
revoke execute on function public.nfce_pendencias() from public, anon;
grant execute on function public.nfce_pendencias() to authenticated;

create or replace function public.nfce_reforma(p_meses int default 3)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_de text := to_char((now() at time zone 'America/Fortaleza')::date - make_interval(months => p_meses - 1), 'YYYY-MM');
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'sem acesso'; end if;
  with m as (
    select m.unidade_id, u.nome casa, coalesce(u.ordem, 99) ordem, public.nfce_categoria(c.grupo, c.nome) categoria,
      coalesce(m.cclasstrib, 'vazio') cclasstrib, m.ibscbs_cst, sum(m.itens) itens, sum(m.valor) valor
    from public.nfce_produtos_mes m join public.totvs_unidades u on u.id = m.unidade_id
    left join public.totvs_produtos_cadastro c on c.loja_codigo = u.loja and c.codigo = m.codigo
    where m.mes >= v_de group by 1, 2, 3, 4, 5, 6
  )
  select jsonb_build_object(
    'de', v_de, 'meses', p_meses,
    'linhas', coalesce((select jsonb_agg(m order by m.ordem, m.categoria, m.valor desc) from m), '[]'),
    'impostos', coalesce((select jsonb_agg(x) from (select n.unidade_id, sum(valor) valor, sum(pis) pis, sum(cofins) cofins, sum(cbs) cbs, sum(ibs) ibs,
        sum(icms) icms, sum(servico) servico from public.nfce_meses n where n.mes >= v_de group by 1) x), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.nfce_reforma(int) from public, anon;
grant execute on function public.nfce_reforma(int) to authenticated;
